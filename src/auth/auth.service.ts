import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { sign, verify, type JwtPayload } from './jwt';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { LoginAttempts } from './login-attempts';
import {
  dummyHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password';
import { SessionsService } from './sessions.service';
import { TwoFactorChallenge, TwoFactorService } from './two-factor.service';
import { UsersRepository } from './users.repository';
import type { User } from './entities/user.entity';

const ACCESS_TTL = 15 * 60; // 15 minutos
const REFRESH_TTL = 7 * 24 * 60 * 60; // 7 días

/** Mismo texto para correo inexistente y contraseña incorrecta (no revela cuentas). */
const BAD_CREDENTIALS = 'Correo o contraseña incorrectos';

/**
 * Registro de usuarios y emisión de tokens JWT.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly twoFactor: TwoFactorService,
    private readonly analytics: AnalyticsService,
    private readonly sessions: SessionsService,
    private readonly attempts: LoginAttempts,
    private readonly audit: AuditService,
  ) {}

  /**
   * Registra un usuario nuevo guardando el hash de su password.
   *
   * @param dto - Nombre, apellido, país, email y password ya validados, con
   * el consentimiento del aviso de privacidad (RNF07).
   * @returns El `id` y `email` del usuario creado y el mensaje de
   * confirmación (CU01). Nunca el password.
   * @throws {@link ConflictException} si el email ya está registrado.
   */
  async register(
    dto: RegisterDto,
  ): Promise<{ id: string; email: string; message: string }> {
    // La columna `correo_electronico` es UNIQUE, así que un duplicado haría fallar el
    // INSERT con un error de MySQL (500). Revisamos antes para dar un 409.
    if (await this.users.findByEmail(dto.email!)) {
      throw new ConflictException('El email ya está registrado');
    }
    const user = await this.users.save(
      {
        email: dto.email,
        name: dto.name,
        lastName: dto.lastName,
        country: dto.country,
      },
      await hashPassword(dto.password!),
    );
    return {
      id: user.id!,
      email: user.email!,
      message: 'Usuario creado con éxito',
    };
  }

  /**
   * Valida credenciales y emite un par de tokens.
   *
   * @param dto - Email y password.
   * @param ip - Dirección del cliente, para el límite de intentos.
   * @returns Un `accessToken` de 15 minutos y un `refreshToken` de 7 días; o,
   * si la cuenta tiene verificación en dos pasos, el desafío que se canjea en
   * `POST /auth/two-factor/verify`.
   * @throws {@link UnauthorizedException} si el correo o el password no
   * coinciden (siempre el mismo mensaje).
   * @throws {@link HttpException} 429 si hay demasiados intentos fallidos.
   * @throws {@link ForbiddenException} si la cuenta está suspendida (RF03).
   */
  async login(
    dto: LoginDto,
    ip = 'desconocida',
  ): Promise<
    { accessToken: string; refreshToken: string } | TwoFactorChallenge
  > {
    const key = LoginAttempts.key(dto.email!, ip);
    const locked = this.attempts.secondsLocked(key);
    if (locked > 0) {
      await this.audit.log('LOGIN_BLOQUEADO', {
        detail: 'demasiados intentos',
        ip,
      });
      throw new HttpException(
        `Demasiados intentos. Intenta de nuevo en ${Math.ceil(locked / 60)} min.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.users.findByEmail(dto.email!);
    // Si el correo no existe se gasta el mismo tiempo hasheando contra un hash
    // de relleno: el tiempo de respuesta no delata qué cuentas existen.
    const valid = user
      ? await verifyPassword(dto.password!, user.passwordHash!)
      : (await verifyPassword(dto.password!, await dummyHash()), false);
    if (!user || !valid) {
      this.attempts.fail(key);
      await this.audit.log('LOGIN_FALLIDO', {
        userId: user?.id,
        detail: user ? 'contraseña incorrecta' : 'correo inexistente',
        ip,
      });
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }
    this.attempts.success(key);
    // Un administrador puede desactivar cuentas (RF03): esas ya no entran.
    if (user.accountStatus !== 'ACTIVO') {
      throw new ForbiddenException('La cuenta está suspendida');
    }
    // Hash viejo (SHA-256 sin sal) o con parámetros débiles: se reemplaza ahora
    // que se conoce la contraseña.
    if (needsRehash(user.passwordHash!)) {
      await this.users.updatePassword(
        user.id!,
        await hashPassword(dto.password!),
      );
    }
    // Con verificación en dos pasos el password no basta: los tokens se
    // entregan hasta que llegue el código.
    if (await this.twoFactor.isEnabled(user.id!)) {
      return this.twoFactor.createChallenge(user.id!, user.email!);
    }
    await this.analytics.count('inicio_sesion', user.id!);
    return this.issueTokens(user, ip);
  }

  /**
   * Segundo paso del login: canjea el código del desafío por los tokens.
   *
   * @param dto - `challengeId` que regresó el login y el código de 6 dígitos.
   * @returns Un `accessToken` de 15 minutos y un `refreshToken` de 7 días.
   * @throws {@link UnauthorizedException} si el código no es válido o expiró,
   * o si la cuenta dejó de estar activa mientras tanto.
   */
  async verifyCode(
    dto: VerifyCodeDto,
    ip?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const userId = await this.twoFactor.verify(dto.challengeId!, dto.code!);
    const user = await this.users.findById(userId);
    if (!user || user.accountStatus !== 'ACTIVO') {
      throw new UnauthorizedException('El código no es válido o ya expiró');
    }
    await this.analytics.count('inicio_sesion', user.id!);
    return this.issueTokens(user, ip);
  }

  /**
   * Canjea un refresh token por un access token nuevo.
   *
   * @param dto - Contiene el `refreshToken` emitido en el login.
   * @returns Un `accessToken` nuevo de 15 minutos.
   * @throws {@link UnauthorizedException} si el token es inválido, expiró, no
   * es de tipo `refresh`, su sesión se cerró o la cuenta ya no está activa.
   */
  async refresh(dto: RefreshDto): Promise<{ accessToken: string }> {
    const payload = verify(dto.refreshToken!);
    // Exigir `type: 'refresh'` impide encadenar access tokens: sin esto, cada
    // access podría canjearse por otro y la sesión nunca caducaría.
    if (!payload || payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh token inválido');
    }
    // Se consulta la base: una sesión cerrada, una cuenta suspendida o borrada
    // ya no renuevan, y el rol sale de la base, no del token viejo.
    const session = await this.sessions.validate(payload.sid, payload.sub);
    if (!session) {
      throw new UnauthorizedException('Refresh token inválido');
    }
    const accessToken = sign(
      {
        sub: payload.sub,
        email: session.email,
        role: session.role,
        type: 'access',
        sid: payload.sid,
      },
      ACCESS_TTL,
    );
    return { accessToken };
  }

  /**
   * Cierra la sesión del token: sus access y refresh tokens dejan de valer en
   * ese momento (CU03, CU10, CU15).
   */
  async logout(user: JwtPayload, ip?: string): Promise<void> {
    await this.sessions.revoke(user.sid);
    await this.audit.log('LOGOUT', { userId: user.sub, ip });
  }

  /**
   * Cambia el password del usuario del token y cierra sus demás sesiones.
   *
   * @param user - Payload del access token que hace el cambio.
   * @param dto - Password actual y nuevo; el nuevo ya cumple las reglas del
   * registro.
   * @throws {@link UnauthorizedException} si la cuenta del token ya no existe.
   * @throws {@link BadRequestException} si el password actual no coincide o
   * el nuevo es igual al actual.
   */
  async changePassword(
    user: JwtPayload,
    dto: ChangePasswordDto,
    ip?: string,
  ): Promise<void> {
    const found = await this.users.findById(user.sub);
    if (!found) {
      throw new UnauthorizedException('El usuario no existe');
    }
    // Pedir el password actual evita que alguien con un token ajeno (o con
    // la sesión abierta de otra persona) se quede con la cuenta. Es un 400 y
    // no un 401: el token es válido, lo que está mal es el dato.
    if (!(await verifyPassword(dto.currentPassword!, found.passwordHash!))) {
      throw new BadRequestException('El password actual es incorrecto');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException(
        'El password nuevo debe ser distinto al actual',
      );
    }
    await this.users.updatePassword(
      user.sub,
      await hashPassword(dto.newPassword!),
    );
    // Si alguien más tenía la sesión abierta, ya no: solo queda esta.
    await this.sessions.revokeAll(user.sub, user.sid);
    await this.audit.log('PASSWORD_CAMBIADA', { userId: user.sub, ip });
  }

  /**
   * Abre una sesión y emite sus dos tokens, con la misma vida que la sesión.
   * Dos tokens con los mismos datos y distinta vida: el access viaja en cada
   * request, así que dura poco por si se filtra; el refresh solo va a
   * /auth/refresh y dura más para no pedir el password cada 15 minutos.
   */
  private async issueTokens(
    user: User,
    ip?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const sid = await this.sessions.create(user.id!, REFRESH_TTL);
    await this.audit.log('LOGIN_OK', { userId: user.id, ip });
    const claims = {
      sub: user.id!,
      email: user.email!,
      role: user.role!,
      sid,
    };
    return {
      accessToken: sign({ ...claims, type: 'access' }, ACCESS_TTL),
      refreshToken: sign({ ...claims, type: 'refresh' }, REFRESH_TTL),
    };
  }
}

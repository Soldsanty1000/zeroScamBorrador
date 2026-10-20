import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/change-password.dto';
import { EmailCodeChallenge, EmailCodeService } from './email-code.service';
import { MailService } from './mail.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { sign, verify } from './jwt';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';
import { AnalyticsService } from '../analytics/analytics.service';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { TwoFactorChallenge, TwoFactorService } from './two-factor.service';
import { UsersRepository } from './users.repository';

const ACCESS_TTL = 15 * 60; // 15 minutos
const REFRESH_TTL = 7 * 24 * 60 * 60; // 7 días

/**
 * Registro de usuarios y emisión de tokens JWT.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly twoFactor: TwoFactorService,
    private readonly analytics: AnalyticsService,
    private readonly emailCodes: EmailCodeService,
    private readonly mail: MailService,
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
   * @returns Un `accessToken` de 15 minutos y un `refreshToken` de 7 días; o,
   * si la cuenta tiene verificación en dos pasos, el desafío que se canjea en
   * `POST /auth/two-factor/verify`.
   * @throws {@link UnauthorizedException} si el usuario no existe o el
   * password no coincide.
   * @throws {@link ForbiddenException} si la cuenta está suspendida (RF03).
   */
  async login(
    dto: LoginDto,
  ): Promise<
    { accessToken: string; refreshToken: string } | TwoFactorChallenge
  > {
    const user = await this.users.findByEmail(dto.email!);
    // No guardamos el password, solo su hash. Para comprobarlo hasheamos lo
    // que llegó con la misma sal y comparamos contra lo guardado. Si el
    // correo no existe se hashea igual contra un hash de relleno: así el
    // tiempo de respuesta tampoco delata qué correos tienen cuenta.
    const ok = await verifyPassword(
      dto.password!,
      user?.passwordHash ?? DUMMY_HASH,
    );
    // Un solo mensaje para correo inexistente y password incorrecto: con dos,
    // cualquiera podría averiguar qué correos están registrados.
    if (!user || !ok) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }
    // Un administrador puede desactivar cuentas (RF03): esas ya no entran.
    if (user.accountStatus !== 'ACTIVO') {
      throw new ForbiddenException('La cuenta está suspendida');
    }
    // Con verificación en dos pasos el password no basta: los tokens se
    // entregan hasta que llegue el código.
    if (await this.twoFactor.isEnabled(user.id!)) {
      return this.twoFactor.createChallenge(user.id!, user.email!);
    }
    // Dos tokens con los mismos datos y distinta vida: el access viaja en cada
    // request, así que dura poco por si se filtra; el refresh solo va a
    // /auth/refresh y dura más para no pedir el password cada 15 minutos.
    // El rol viaja en el token para el control de acceso por roles (RNF04).
    const claims = { sub: user.id!, email: user.email!, role: user.role! };
    const accessToken = sign({ ...claims, type: 'access' }, ACCESS_TTL);
    const refreshToken = sign({ ...claims, type: 'refresh' }, REFRESH_TTL);
    await this.analytics.count('inicio_sesion', user.id!);
    return { accessToken, refreshToken };
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
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const userId = await this.twoFactor.verify(dto.challengeId!, dto.code!);
    const user = await this.users.findById(userId);
    if (!user || user.accountStatus !== 'ACTIVO') {
      throw new UnauthorizedException('El código no es válido o ya expiró');
    }
    const claims = { sub: user.id!, email: user.email!, role: user.role! };
    await this.analytics.count('inicio_sesion', user.id!);
    return {
      accessToken: sign({ ...claims, type: 'access' }, ACCESS_TTL),
      refreshToken: sign({ ...claims, type: 'refresh' }, REFRESH_TTL),
    };
  }

  /**
   * Canjea un refresh token por un access token nuevo.
   *
   * @param dto - Contiene el `refreshToken` emitido en el login.
   * @returns Un `accessToken` nuevo de 15 minutos.
   * @throws {@link UnauthorizedException} si el token es inválido, expiró o no
   * es de tipo `refresh`.
   */
  async refresh(dto: RefreshDto): Promise<{ accessToken: string }> {
    const payload = verify(dto.refreshToken!);
    // Exigir `type: 'refresh'` impide encadenar access tokens: sin esto, cada
    // access podría canjearse por otro y la sesión nunca caducaría.
    if (!payload || payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh token inválido');
    }
    // La firma prueba que lo emitimos, pero no que la sesión siga valiendo:
    // una cuenta suspendida o eliminada ya no renueva, y tras un cambio de
    // contraseña los refresh tokens de antes dejan de servir (quien tuviera
    // la cuenta pierde el acceso al vencer su access token de 15 minutos).
    const user = await this.users.findById(payload.sub);
    const changed = user?.passwordChangedAt?.getTime() ?? 0;
    const issued = payload.iatMs ?? payload.iat * 1000;
    if (!user || user.accountStatus !== 'ACTIVO' || issued < changed) {
      throw new UnauthorizedException('Refresh token inválido');
    }
    const accessToken = sign(
      {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        type: 'access',
      },
      ACCESS_TTL,
    );
    return { accessToken };
  }

  /**
   * Manda al correo de la cuenta el código para cambiar el password con la
   * sesión abierta. Con el código, quien encuentre el teléfono desbloqueado
   * no puede cambiarlo sin tener también el correo.
   *
   * @throws {@link HttpException} 429 si ya pidió {@link SEND_LIMIT} códigos.
   */
  async requestChangeCode(userId: string): Promise<EmailCodeChallenge> {
    const user = await this.users.findById(userId);
    if (!user || user.accountStatus !== 'ACTIVO') {
      throw new UnauthorizedException('El usuario no existe');
    }
    return this.emailCodes.create(
      this.emailCodes.newId(),
      user.id!,
      user.email!,
      'CAMBIAR',
    );
  }

  /**
   * Cambia el password del usuario del token. Pide el password actual y el
   * código que llegó al correo, avisa por correo y regresa tokens nuevos:
   * los de antes de este cambio ya no se renuevan.
   *
   * @param userId - `sub` del access token.
   * @param dto - Password actual, nuevo, `challengeId` y código.
   * @throws {@link UnauthorizedException} si la cuenta del token ya no existe.
   * @throws {@link BadRequestException} si el nuevo es igual al actual, el
   * código no sirve o el password actual no coincide (el código ya se gastó).
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.users.findById(userId);
    if (!user || user.accountStatus !== 'ACTIVO') {
      throw new UnauthorizedException('El usuario no existe');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException(
        'El password nuevo debe ser distinto al actual',
      );
    }
    // El código va antes que el password actual: sin un código del correo,
    // un token robado no sirve para adivinar el password, y con él cada
    // intento gasta el código (3 códigos cada 15 minutos).
    const owner = await this.emailCodes.verify(
      dto.challengeId!,
      dto.code!,
      'CAMBIAR',
      user.id,
    );
    if (owner !== user.id) {
      throw new BadRequestException('El código no es válido o ya expiró');
    }
    // Pedir el password actual evita que alguien con un token ajeno (o con
    // la sesión abierta de otra persona) se quede con la cuenta. Es un 400 y
    // no un 401: el token es válido, lo que está mal es el dato.
    if (!(await verifyPassword(dto.currentPassword!, user.passwordHash))) {
      throw new BadRequestException(
        'El password actual es incorrecto. Pide un código nuevo.',
      );
    }
    await this.users.updatePassword(
      userId,
      await hashPassword(dto.newPassword!),
    );
    await this.afterPasswordChange(user.id!, user.email!, 'cambio');
    const claims = { sub: user.id!, email: user.email!, role: user.role! };
    return {
      accessToken: sign({ ...claims, type: 'access' }, ACCESS_TTL),
      refreshToken: sign({ ...claims, type: 'refresh' }, REFRESH_TTL),
    };
  }

  /**
   * "Olvidé mi contraseña": manda un código al correo si tiene una cuenta
   * activa. La respuesta es la misma exista o no la cuenta (un `challengeId`
   * nuevo y su vencimiento), y el correo se manda sin esperarlo, para que ni
   * el contenido ni el tiempo de respuesta digan qué correos están
   * registrados.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{
    challengeId: string;
    expiresAt: string;
    message: string;
  }> {
    const id = this.emailCodes.newId();
    const answer = {
      challengeId: id,
      expiresAt: this.emailCodes.expiresFromNow(),
      message:
        'Si el correo tiene una cuenta, te enviamos un código para poner una contraseña nueva.',
    };
    const user = await this.users.findByEmail(dto.email!.trim().toLowerCase());
    if (!user || user.accountStatus !== 'ACTIVO') return answer;
    this.emailCodes
      .create(id, user.id!, user.email!, 'RECUPERAR')
      .catch((err: unknown) =>
        // Límite alcanzado o correo caído: la respuesta ya salió igual.
        this.logger.warn(
          'No se mandó un código de recuperación: ' +
            (err instanceof Error ? err.message : String(err)),
        ),
      );
    return answer;
  }

  /**
   * Pone un password nuevo con el código de "Olvidé mi contraseña". Cierra
   * las demás sesiones (sus refresh tokens dejan de servir) y avisa por
   * correo.
   *
   * @throws {@link BadRequestException} con el mismo mensaje si el código no
   * existe, expiró, se agotaron los intentos o la cuenta ya no está activa.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const invalid = new BadRequestException(
      'El código no es válido o ya expiró',
    );
    const userId = await this.emailCodes.verify(
      dto.challengeId!,
      dto.code!,
      'RECUPERAR',
    );
    if (!userId) throw invalid;
    const user = await this.users.findById(userId);
    if (!user || user.accountStatus !== 'ACTIVO') throw invalid;
    await this.users.updatePassword(
      userId,
      await hashPassword(dto.newPassword!),
    );
    await this.afterPasswordChange(user.id!, user.email!, 'recuperacion');
  }

  /**
   * Después de cualquier cambio de password: anula códigos y desafíos
   * pendientes y avisa al correo. Si el aviso no sale, el cambio ya quedó;
   * solo se registra.
   */
  private async afterPasswordChange(
    userId: string,
    email: string,
    how: 'cambio' | 'recuperacion',
  ): Promise<void> {
    await this.emailCodes.clear(userId);
    await this.twoFactor.clear(userId);
    await this.mail
      .sendPasswordChanged(email, new Date(), how)
      .catch((err: unknown) =>
        this.logger.warn(
          'No se mandó el aviso de contraseña cambiada: ' +
            (err instanceof Error ? err.message : String(err)),
        ),
      );
  }
}

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { sign, verify } from './jwt';
import { UsersRepository } from './users.repository';

const ACCESS_TTL = 15 * 60; // 15 minutos
const REFRESH_TTL = 7 * 24 * 60 * 60; // 7 días

/**
 * Registro de usuarios y emisión de tokens JWT.
 */
@Injectable()
export class AuthService {
  constructor(private readonly users: UsersRepository) {}

  /**
   * Registra un usuario nuevo guardando el hash de su password.
   *
   * @param dto - Nombre, apellido, país, email y password ya validados.
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
      hash(dto.password!),
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
   * @returns Un `accessToken` de 15 minutos y un `refreshToken` de 7 días.
   * @throws {@link UnauthorizedException} si el usuario no existe o el
   * password no coincide.
   * @throws {@link ForbiddenException} si la cuenta está suspendida (RF03).
   */
  async login(
    dto: LoginDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.users.findByEmail(dto.email!);
    if (!user) {
      throw new UnauthorizedException('El usuario no existe');
    }
    // No guardamos el password, solo su hash. Para comprobarlo hasheamos lo
    // que llegó y comparamos contra lo guardado.
    if (user.passwordHash !== hash(dto.password!)) {
      throw new UnauthorizedException('Password incorrecto');
    }
    // Un administrador puede desactivar cuentas (RF03): esas ya no entran.
    if (user.accountStatus !== 'ACTIVO') {
      throw new ForbiddenException('La cuenta está suspendida');
    }
    // Dos tokens con los mismos datos y distinta vida: el access viaja en cada
    // request, así que dura poco por si se filtra; el refresh solo va a
    // /auth/refresh y dura más para no pedir el password cada 15 minutos.
    // El rol viaja en el token para el control de acceso por roles (RNF04).
    const claims = { sub: user.id!, email: user.email!, role: user.role! };
    const accessToken = sign({ ...claims, type: 'access' }, ACCESS_TTL);
    const refreshToken = sign({ ...claims, type: 'refresh' }, REFRESH_TTL);
    console.log('Login de ' + user.email + ': ' + accessToken);
    return { accessToken, refreshToken };
  }

  /**
   * Canjea un refresh token por un access token nuevo.
   *
   * @param dto - Contiene el `refreshToken` emitido en el login.
   * @returns Un `accessToken` nuevo de 15 minutos.
   * @throws {@link UnauthorizedException} si el token es inválido, expiró o no
   * es de tipo `refresh`.
   */
  refresh(dto: RefreshDto): { accessToken: string } {
    // No consulta la base: `sub` y `email` vienen dentro del token, y la firma
    // garantiza que lo emitimos nosotros.
    const payload = verify(dto.refreshToken!);
    // Exigir `type: 'refresh'` impide encadenar access tokens: sin esto, cada
    // access podría canjearse por otro y la sesión nunca caducaría.
    if (!payload || payload.type !== 'refresh') {
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
}

/**
 * Hashea un password con SHA-256.
 *
 * @param password - Password en texto plano.
 * @returns El hash en hexadecimal: 64 caracteres; cabe en la columna
 * `contrasena_hash` (VARCHAR(255)).
 */
function hash(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

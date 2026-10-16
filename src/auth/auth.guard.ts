import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtPayload, verify } from './jwt';
import { SessionsService } from './sessions.service';

/**
 * Protege rutas con un JWT de acceso.
 *
 * Lee `Authorization: Bearer <token>`, verifica firma y expiración con
 * {@link verify} y comprueba en la base que la sesión (`sid`) siga vigente y la
 * cuenta activa. Si todo cuadra deja el payload en `req.user` para que
 * `@CurrentUser()` lo lea, con el rol y el correo ACTUALES de la base.
 * Rechaza con 401 **antes** de llegar al controller.
 *
 * Solo acepta tokens de tipo `access`: un refresh token válido también
 * recibe 401, porque no sirve para pedir recursos.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta el token');
    }
    const payload = verify(header.slice('Bearer '.length));
    if (!payload || payload.type !== 'access') {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    const session = await this.sessions.validate(payload.sid, payload.sub);
    if (!session) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    req.user = { ...payload, role: session.role, email: session.email };
    return true;
  }
}

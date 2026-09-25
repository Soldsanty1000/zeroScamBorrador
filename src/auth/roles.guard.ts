import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from './jwt';
import { ROLES_KEY } from './roles.decorator';

/**
 * Control de acceso por roles (RNF04).
 *
 * Va **después** de {@link AuthGuard}, que es quien deja el payload en
 * `req.user`: `@UseGuards(AuthGuard, RolesGuard)`. Compara el `role` del
 * token contra los de `@Roles(...)` y rechaza con 403 si no está.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles) return true;
    const user = context.switchToHttp().getRequest<{ user: JwtPayload }>().user;
    if (!roles.includes(user.role)) {
      throw new ForbiddenException('Tu rol no tiene acceso a esta ruta');
    }
    return true;
  }
}

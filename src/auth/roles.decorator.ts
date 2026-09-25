import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Roles que pueden usar una ruta (RNF04). Lo lee {@link RolesGuard}; sin
 * este decorador cualquier usuario con token entra.
 *
 * @example `@Roles(ROLES.ADMIN, ROLES.OWNER)`
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

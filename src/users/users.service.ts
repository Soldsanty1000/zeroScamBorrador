import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/jwt';
import { UsersRepository } from '../auth/users.repository';
import { ROLES } from '../common/constants';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserFiltersDto } from './dto/user-filters.dto';
import { UserResponseDto } from './dto/user-response.dto';

/**
 * Consulta y mantenimiento de cuentas (RF03).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Obtiene un usuario por id.
   *
   * @param id - `id_usuario`.
   * @returns El usuario encontrado.
   * @throws {@link NotFoundException} si no existe.
   */
  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException('Usuario ' + id + ' no encontrado');
    }
    return UserResponseDto.fromEntity(user);
  }

  /**
   * Lista las cuentas registradas.
   *
   * @param filters - Filtros opcionales de rol, estado y texto.
   * @returns Los usuarios que cumplen los filtros.
   */
  async findAll(filters: UserFiltersDto): Promise<UserResponseDto[]> {
    const users = await this.users.findAll(filters);
    return users.map((u) => UserResponseDto.fromEntity(u));
  }

  /**
   * Edita los datos del propio usuario.
   *
   * @param id - `sub` del access token.
   * @param changes - Nombre, apellido o país; los ausentes no se tocan.
   * @returns El usuario ya actualizado.
   * @throws {@link NotFoundException} si la cuenta del token ya no existe.
   */
  async updateMe(
    id: string,
    changes: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    const updated = await this.users.update(id, changes);
    if (!updated) {
      throw new NotFoundException('Usuario ' + id + ' no encontrado');
    }
    return UserResponseDto.fromEntity(updated);
  }

  /**
   * Edita o desactiva una cuenta.
   *
   * @param actor - Payload del token de quien hace el cambio.
   * @param id - `id_usuario` de la cuenta a cambiar.
   * @param changes - Campos a cambiar.
   * @returns El usuario ya actualizado.
   * @throws {@link ForbiddenException} si un Administrador intenta cambiar
   * roles o tocar una cuenta Owner.
   * @throws {@link NotFoundException} si no existe.
   */
  async update(
    actor: JwtPayload,
    id: string,
    changes: UpdateUserDto,
    ip?: string,
  ): Promise<UserResponseDto> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException('Usuario ' + id + ' no encontrado');
    }
    const isStaffAccount =
      user.role === ROLES.ADMIN ||
      user.role === ROLES.POLICE ||
      user.role === ROLES.OWNER;
    const changesRole =
      changes.role !== undefined && changes.role !== user.role;
    const suspends = changes.accountStatus === 'SUSPENDIDO';
    // Solo el Owner designa roles y administra cuentas de staff
    // (Administrador, Policía y otros Owner). El Administrador solo modera
    // cuentas de ciudadanos.
    if (actor.role !== ROLES.OWNER) {
      if (changes.role) {
        throw new ForbiddenException('Solo el Owner puede cambiar roles');
      }
      if (isStaffAccount) {
        throw new ForbiddenException(
          'Solo el Owner puede editar cuentas de staff',
        );
      }
    }
    // Nadie se quita su propio rol ni se suspende a sí mismo: un error o un
    // token robado no debe poder dejar a la administración sin cabeza.
    if (user.id === actor.sub && (changesRole || suspends)) {
      throw new ForbiddenException(
        'No puedes cambiar tu propio rol ni suspender tu propia cuenta',
      );
    }
    // Siempre debe quedar al menos un Owner activo.
    if (
      user.role === ROLES.OWNER &&
      (changesRole || suspends) &&
      (await this.users.countActiveByRole(ROLES.OWNER)) <= 1
    ) {
      throw new ForbiddenException('El sistema debe conservar un Owner activo');
    }
    const updated = (await this.users.update(id, changes))!;
    // Rol y estado salen de la base en cada petición (AuthGuard): el cambio
    // aplica de inmediato. La bitácora no guarda textos libres.
    if (changesRole) {
      await this.audit.log('ROL_CAMBIADO', {
        userId: actor.sub,
        detail: `usuario ${id}: ${user.role} -> ${changes.role}`,
        ip,
      });
    }
    if (changes.accountStatus && changes.accountStatus !== user.accountStatus) {
      await this.audit.log('CUENTA_SUSPENDIDA', {
        userId: actor.sub,
        detail: `usuario ${id}: ${user.accountStatus} -> ${changes.accountStatus}`,
        ip,
      });
    }
    if (!changesRole && !changes.accountStatus) {
      await this.audit.log('CUENTA_EDITADA_POR_STAFF', {
        userId: actor.sub,
        detail: `usuario ${id}`,
        ip,
      });
    }
    return UserResponseDto.fromEntity(updated);
  }
}

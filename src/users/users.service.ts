import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  constructor(private readonly users: UsersRepository) {}

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
  ): Promise<UserResponseDto> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException('Usuario ' + id + ' no encontrado');
    }
    // Solo el Owner designa roles y administra otras cuentas Owner.
    if (actor.role !== ROLES.OWNER) {
      if (changes.role) {
        throw new ForbiddenException('Solo el Owner puede cambiar roles');
      }
      if (user.role === ROLES.OWNER) {
        throw new ForbiddenException('Solo el Owner puede editar a un Owner');
      }
    }
    const updated = (await this.users.update(id, changes))!;
    return UserResponseDto.fromEntity(updated);
  }
}

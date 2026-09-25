import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { User } from './entities/user.entity';

const COLUMNS =
  'u.id_usuario, u.correo_electronico, u.contrasena_hash, u.nombre, u.apellido, ' +
  'u.pais, u.estado_cuenta, u.fecha_registro, r.nombre_rol';

/**
 * Acceso a la tabla `Usuario` de MySQL.
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Busca un usuario por email.
   *
   * @param email - Email exacto a buscar.
   * @returns El usuario, o `undefined` si no hay ninguno con ese email.
   */
  async findByEmail(email: string): Promise<User | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM Usuario u JOIN Rol r ON r.id_rol = u.id_rol
       WHERE u.correo_electronico = '${email}'`,
    );
    return rows[0] && toEntity(rows[0]);
  }

  /**
   * Inserta un usuario con rol `Usuario` y lo regresa tal como quedó en la
   * base.
   *
   * @param user - Datos del usuario; el email debe ser único.
   * @param passwordHash - Hash SHA-256 en hex del password, no el password.
   * @returns El usuario guardado, con `id` y `createdAt` asignados.
   */
  async save(
    user: Pick<User, 'email' | 'name' | 'lastName' | 'country'>,
    passwordHash: string,
  ): Promise<User> {
    // `id_usuario` es AUTO_INCREMENT: lo asigna MySQL. Todo registro nuevo
    // entra con el rol `Usuario`; los demás roles se asignan a mano.
    await this.pool.query(
      `INSERT INTO Usuario (id_rol, nombre, apellido, pais, correo_electronico, contrasena_hash)
       VALUES ((SELECT id_rol FROM Rol WHERE nombre_rol = 'Usuario'),
               '${user.name}', '${user.lastName}', '${user.country}', '${user.email}', '${passwordHash}')`,
    );
    // Releemos para traer el `id_usuario` y `fecha_registro` que asignó MySQL.
    return (await this.findByEmail(user.email!))!;
  }
}

/**
 * Convierte una fila de MySQL en una entidad {@link User}.
 *
 * @param row - Fila con las columnas de `COLUMNS`.
 * @returns La entidad con los nombres de campo en camelCase.
 */
function toEntity(row: any): User {
  const user = new User();
  user.id = String(row.id_usuario);
  user.email = row.correo_electronico;
  user.passwordHash = row.contrasena_hash;
  user.name = row.nombre;
  user.lastName = row.apellido;
  user.country = row.pais;
  user.role = row.nombre_rol;
  user.accountStatus = row.estado_cuenta;
  user.createdAt = row.fecha_registro;
  return user;
}

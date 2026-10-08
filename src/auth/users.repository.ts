import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { User } from './entities/user.entity';

const COLUMNS =
  'u.id_usuario, u.correo_electronico, u.contrasena_hash, u.nombre, u.apellido, ' +
  'u.pais, u.estado_cuenta, u.fecha_registro, u.fecha_consentimiento, r.nombre_rol';

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
   * base. Deja constancia de la fecha en que aceptó el aviso de privacidad
   * (RNF07): el DTO de registro ya exigió ese consentimiento.
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
      `INSERT INTO Usuario (id_rol, nombre, apellido, pais, correo_electronico, contrasena_hash, fecha_consentimiento)
       VALUES ((SELECT id_rol FROM Rol WHERE nombre_rol = 'Usuario'),
               '${user.name}', '${user.lastName}', '${user.country}', '${user.email}', '${passwordHash}', NOW())`,
    );
    // Releemos para traer el `id_usuario` y `fecha_registro` que asignó MySQL.
    return (await this.findByEmail(user.email!))!;
  }

  /**
   * Busca un usuario por id.
   *
   * @param id - `id_usuario`.
   * @returns El usuario, o `undefined` si no existe.
   */
  async findById(id: string): Promise<User | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM Usuario u JOIN Rol r ON r.id_rol = u.id_rol
       WHERE u.id_usuario = '${id}'`,
    );
    return rows[0] && toEntity(rows[0]);
  }

  /**
   * Lista usuarios, opcionalmente filtrados (RF03).
   *
   * @param filters - Rol, estado de cuenta y texto a buscar en nombre,
   * apellido o email; los que no vengan no filtran.
   * @returns Los usuarios ordenados por fecha de registro.
   */
  async findAll(filters: {
    role?: string;
    accountStatus?: string;
    q?: string;
  }): Promise<User[]> {
    const where = ['1 = 1'];
    if (filters.role) where.push(`r.nombre_rol = '${filters.role}'`);
    if (filters.accountStatus) {
      where.push(`u.estado_cuenta = '${filters.accountStatus}'`);
    }
    if (filters.q) {
      where.push(
        `(u.nombre LIKE '%${filters.q}%' OR u.apellido LIKE '%${filters.q}%' ` +
          `OR u.correo_electronico LIKE '%${filters.q}%')`,
      );
    }
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM Usuario u JOIN Rol r ON r.id_rol = u.id_rol
       WHERE ${where.join(' AND ')} ORDER BY u.fecha_registro`,
    );
    return rows.map(toEntity);
  }

  /**
   * Actualiza solo los campos presentes en `changes`.
   *
   * @param id - `id_usuario`.
   * @param changes - Campos a modificar; los ausentes no se tocan.
   * @returns El usuario después del cambio, o `undefined` si no existe.
   */
  async update(
    id: string,
    changes: Partial<
      Pick<User, 'name' | 'lastName' | 'country' | 'accountStatus' | 'role'>
    >,
  ): Promise<User | undefined> {
    // Los campos del DTO no se llaman como las columnas, así que el SET se
    // arma con este mapa.
    const columns: Record<string, string> = {
      name: 'nombre',
      lastName: 'apellido',
      country: 'pais',
      accountStatus: 'estado_cuenta',
    };
    const sets = Object.entries(changes)
      .filter(([field, value]) => columns[field] && value !== undefined)
      .map(([field, value]) => `${columns[field]} = '${value}'`);
    if (changes.role) {
      sets.push(
        `id_rol = (SELECT id_rol FROM Rol WHERE nombre_rol = '${changes.role}')`,
      );
    }
    // Sin cambios no hay UPDATE: MySQL rechaza un SET vacío.
    if (sets.length > 0) {
      await this.pool.query(
        `UPDATE Usuario SET ${sets.join(', ')} WHERE id_usuario = '${id}'`,
      );
    }
    return this.findById(id);
  }

  /**
   * Reemplaza el hash del password de un usuario.
   *
   * @param id - `id_usuario`.
   * @param passwordHash - Hash SHA-256 en hex del password nuevo.
   */
  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE Usuario SET contrasena_hash = '${passwordHash}' WHERE id_usuario = '${id}'`,
    );
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
  user.privacyAcceptedAt = row.fecha_consentimiento ?? undefined;
  return user;
}

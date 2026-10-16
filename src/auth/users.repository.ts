import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { containsPattern } from '../common/sql';
import { DB_POOL } from '../database/database.module';
import { User } from './entities/user.entity';

const COLUMNS =
  'u.id_usuario, u.correo_electronico, u.contrasena_hash, u.nombre, u.apellido, ' +
  'u.pais, u.estado_cuenta, u.fecha_registro, u.fecha_consentimiento, r.nombre_rol';

/** Tope duro de filas por consulta de listado (evita respuestas enormes). */
const MAX_ROWS = 500;

/**
 * Acceso a la tabla `Usuario` de MySQL.
 *
 * Todas las consultas van parametrizadas (`?`): ningún dato del usuario se
 * pega al texto del SQL.
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
       WHERE u.correo_electronico = ?`,
      [email],
    );
    return rows[0] && toEntity(rows[0]);
  }

  /**
   * Inserta un usuario con rol `Usuario` y lo regresa tal como quedó en la
   * base. Deja constancia de la fecha en que aceptó el aviso de privacidad
   * (RNF07): el DTO de registro ya exigió ese consentimiento.
   *
   * @param user - Datos del usuario; el email debe ser único.
   * @param passwordHash - Hash scrypt del password, no el password.
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
       VALUES ((SELECT id_rol FROM Rol WHERE nombre_rol = 'Usuario'), ?, ?, ?, ?, ?, NOW())`,
      [user.name, user.lastName, user.country, user.email, passwordHash],
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
       WHERE u.id_usuario = ?`,
      [id],
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
    const params: string[] = [];
    if (filters.role) {
      where.push('r.nombre_rol = ?');
      params.push(filters.role);
    }
    if (filters.accountStatus) {
      where.push('u.estado_cuenta = ?');
      params.push(filters.accountStatus);
    }
    if (filters.q) {
      where.push(
        '(u.nombre LIKE ? OR u.apellido LIKE ? OR u.correo_electronico LIKE ?)',
      );
      const pattern = containsPattern(filters.q);
      params.push(pattern, pattern, pattern);
    }
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM Usuario u JOIN Rol r ON r.id_rol = u.id_rol
       WHERE ${where.join(' AND ')} ORDER BY u.fecha_registro LIMIT ${MAX_ROWS}`,
      params,
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
    // arma con este mapa. Los NOMBRES de columna salen de aquí (constantes);
    // los valores van como parámetros.
    const columns: Record<string, string> = {
      name: 'nombre',
      lastName: 'apellido',
      country: 'pais',
      accountStatus: 'estado_cuenta',
    };
    const sets: string[] = [];
    const params: string[] = [];
    for (const [field, value] of Object.entries(changes)) {
      if (columns[field] && value !== undefined) {
        sets.push(`${columns[field]} = ?`);
        params.push(String(value));
      }
    }
    if (changes.role) {
      sets.push('id_rol = (SELECT id_rol FROM Rol WHERE nombre_rol = ?)');
      params.push(changes.role);
    }
    // Sin cambios no hay UPDATE: MySQL rechaza un SET vacío.
    if (sets.length > 0) {
      await this.pool.query(
        `UPDATE Usuario SET ${sets.join(', ')} WHERE id_usuario = ?`,
        [...params, id],
      );
    }
    return this.findById(id);
  }

  /** Cuántas cuentas ACTIVAS tienen un rol (para no dejar al sistema sin Owner). */
  async countActiveByRole(role: string): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM Usuario u JOIN Rol r ON r.id_rol = u.id_rol
       WHERE r.nombre_rol = ? AND u.estado_cuenta = 'ACTIVO'`,
      [role],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Reemplaza el hash del password de un usuario.
   *
   * @param id - `id_usuario`.
   * @param passwordHash - Hash scrypt del password nuevo.
   */
  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE Usuario SET contrasena_hash = ? WHERE id_usuario = ?',
      [passwordHash, id],
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

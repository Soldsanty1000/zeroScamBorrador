import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { User } from './entities/user.entity';

const COLUMNS =
  'u.id_usuario, u.correo_electronico, u.contrasena_hash, u.nombre, u.apellido, ' +
  'u.pais, u.alias, u.estado_cuenta, u.fecha_registro, u.fecha_consentimiento, ' +
  'u.contrasena_cambiada, r.nombre_rol';

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
   * @param passwordHash - Hash del password (ver `auth/password.ts`), no el password.
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
               ?, ?, ?, ?, ?, NOW())`,
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
   * apellido, alias o email; los que no vengan no filtran.
   * @returns Los usuarios ordenados por fecha de registro.
   */
  async findAll(filters: {
    role?: string;
    accountStatus?: string;
    q?: string;
  }): Promise<User[]> {
    // Cada condición lleva sus `?`; los valores van aparte en `params`.
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
      const like = `%${filters.q}%`;
      // El alias por defecto (`usuario<id>`) no está guardado: se arma igual
      // que en `account.repository.ts` para que también se encuentre.
      where.push(
        `(u.nombre LIKE ? OR u.apellido LIKE ? OR u.correo_electronico LIKE ?
          OR COALESCE(u.alias, CONCAT('usuario', u.id_usuario)) LIKE ?)`,
      );
      params.push(like, like, like, like);
    }
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM Usuario u JOIN Rol r ON r.id_rol = u.id_rol
       WHERE ${where.join(' AND ')} ORDER BY u.fecha_registro`,
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
    // arma con este mapa. Solo sus columnas pueden entrar al SQL; los valores
    // van como `?`.
    const columns: Record<string, string> = {
      name: 'nombre',
      lastName: 'apellido',
      country: 'pais',
      accountStatus: 'estado_cuenta',
    };
    const sets: string[] = [];
    const params: string[] = [];
    for (const [field, value] of Object.entries(changes)) {
      if (!columns[field] || value === undefined) continue;
      sets.push(`${columns[field]} = ?`);
      params.push(String(value));
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

  /**
   * Reemplaza el hash del password de un usuario.
   *
   * @param id - `id_usuario`.
   * @param passwordHash - Hash del password nuevo (ver `auth/password.ts`).
   */
  async updatePassword(id: string, passwordHash: string): Promise<void> {
    // La fecha del cambio invalida los refresh tokens emitidos antes. Va con
    // milisegundos y la pone Node, no `NOW()`: se compara con la hora de
    // emisión del token, que también sale del reloj de Node.
    await this.pool.query(
      'UPDATE Usuario SET contrasena_hash = ?, contrasena_cambiada = ? WHERE id_usuario = ?',
      [passwordHash, new Date(), id],
    );
  }
}

/** Columnas que trae `COLUMNS`, con el tipo que regresa mysql2. */
interface UserRow {
  id_usuario: number | string;
  correo_electronico: string;
  contrasena_hash: string;
  nombre: string;
  apellido: string;
  pais: string;
  alias: string | null;
  nombre_rol: string;
  estado_cuenta: string;
  fecha_registro: Date;
  fecha_consentimiento: Date | null;
  contrasena_cambiada: Date | null;
}

/**
 * Convierte una fila de MySQL en una entidad {@link User}.
 *
 * @param row - Fila con las columnas de `COLUMNS`.
 * @returns La entidad con los nombres de campo en camelCase.
 */
function toEntity(row: RowDataPacket): User {
  const r = row as UserRow;
  const user = new User();
  user.id = String(r.id_usuario);
  user.email = r.correo_electronico;
  user.passwordHash = r.contrasena_hash;
  user.name = r.nombre;
  user.lastName = r.apellido;
  user.country = r.pais;
  // Sin alias guardado vale el de por defecto, el mismo que ve la app.
  user.alias = r.alias ?? `usuario${r.id_usuario}`;
  user.role = r.nombre_rol;
  user.accountStatus = r.estado_cuenta;
  user.createdAt = r.fecha_registro;
  user.privacyAcceptedAt = r.fecha_consentimiento ?? undefined;
  user.passwordChangedAt = r.contrasena_cambiada ?? undefined;
  return user;
}

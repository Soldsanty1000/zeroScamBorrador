import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { User } from './entities/user.entity';

const COLUMNS = 'id, email, password_hash, created_at';

/**
 * Acceso a la tabla `users` de MySQL.
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
      `SELECT ${COLUMNS} FROM users WHERE email = '${email}'`,
    );
    return rows[0] && toEntity(rows[0]);
  }

  /**
   * Inserta un usuario y lo regresa tal como quedó en la base.
   *
   * @param email - Email del usuario; debe ser único.
   * @param passwordHash - Hash SHA-256 en hex del password, no el password.
   * @returns El usuario guardado, con `id` y `createdAt` asignados.
   */
  async save(email: string, passwordHash: string): Promise<User> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ('${id}', '${email}', '${passwordHash}')`,
    );
    // Releemos para traer el `created_at` que asignó MySQL.
    return (await this.findByEmail(email))!;
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
  user.id = row.id;
  user.email = row.email;
  user.passwordHash = row.password_hash;
  user.createdAt = row.created_at;
  return user;
}

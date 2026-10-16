import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { DB_POOL } from '../database/database.module';

/** Quién es el dueño de una sesión vigente, tal como está HOY en la base. */
export interface ActiveSession {
  role: string;
  email: string;
}

/**
 * Sesiones de login (`Sesion`).
 *
 * Cada login crea una fila; sus tokens llevan el id (`sid`). Cerrar sesión,
 * cambiar la contraseña o que la cuenta se suspenda hacen que esa fila deje de
 * valer, y con ella todos los tokens de la sesión, aunque no hayan expirado.
 * Además el rol sale siempre de la base, no del token: un cambio de rol aplica
 * en la siguiente petición.
 */
@Injectable()
export class SessionsService {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Abre una sesión nueva.
   * @param userId - `id_usuario`.
   * @param ttlSeconds - Vida de la sesión (la del refresh token).
   * @returns El id de la sesión, 32 caracteres hexadecimales.
   */
  async create(userId: string, ttlSeconds: number): Promise<string> {
    const id = randomBytes(16).toString('hex');
    await this.pool.query(
      'INSERT INTO Sesion (id_sesion, id_usuario, expira) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
      [id, userId, Math.trunc(ttlSeconds)],
    );
    // Limpieza oportunista de sesiones vencidas hace más de un día.
    await this.pool.query(
      'DELETE FROM Sesion WHERE expira < DATE_SUB(NOW(), INTERVAL 1 DAY)',
    );
    return id;
  }

  /**
   * Comprueba que la sesión exista, no esté revocada ni vencida, sea de ese
   * usuario y que la cuenta siga activa.
   * @returns Rol y correo actuales del dueño, o `null` si ya no vale.
   */
  async validate(sid: string, userId: string): Promise<ActiveSession | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT r.nombre_rol AS role, u.correo_electronico AS email
       FROM Sesion s
       JOIN Usuario u ON u.id_usuario = s.id_usuario
       JOIN Rol r ON r.id_rol = u.id_rol
       WHERE s.id_sesion = ? AND s.id_usuario = ? AND s.revocada = FALSE
         AND s.expira > NOW() AND u.estado_cuenta = 'ACTIVO'`,
      [sid, userId],
    );
    const row = rows[0];
    return row ? { role: String(row.role), email: String(row.email) } : null;
  }

  /** Revoca una sesión (cerrar sesión). */
  async revoke(sid: string): Promise<void> {
    await this.pool.query(
      'UPDATE Sesion SET revocada = TRUE WHERE id_sesion = ?',
      [sid],
    );
  }

  /**
   * Revoca todas las sesiones de un usuario, salvo una si se indica (la que
   * está usando para cambiar su contraseña).
   */
  async revokeAll(userId: string, exceptSid?: string): Promise<void> {
    if (exceptSid) {
      await this.pool.query(
        'UPDATE Sesion SET revocada = TRUE WHERE id_usuario = ? AND id_sesion <> ?',
        [userId, exceptSid],
      );
      return;
    }
    await this.pool.query(
      'UPDATE Sesion SET revocada = TRUE WHERE id_usuario = ?',
      [userId],
    );
  }
}

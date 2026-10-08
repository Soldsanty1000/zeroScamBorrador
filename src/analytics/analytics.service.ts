import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';

/**
 * Contadores anónimos de uso (`Analitica_Evento`): un total por evento, sin
 * id de usuario, y solo si la persona lo permite en sus preferencias.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Suma uno al contador de un evento si el usuario tiene las analíticas
   * encendidas. Nunca falla: un contador no debe tirar la operación.
   *
   * @param event - Nombre del evento, p. ej. `inicio_sesion`.
   * @param userId - `id_usuario` de quien hizo la acción.
   */
  async count(event: string, userId: string | number): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO Analitica_Evento (nombre, total)
         SELECT ?, 1 FROM Usuario WHERE id_usuario = ? AND pref_analiticas = TRUE
         ON DUPLICATE KEY UPDATE total = total + 1`,
        [event, userId],
      );
    } catch {
      // Sin contador no pasa nada.
    }
  }

  /** Todos los contadores, `{ evento: total }`. */
  async totals(): Promise<Record<string, number>> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT nombre, total FROM Analitica_Evento ORDER BY nombre',
    );
    return Object.fromEntries(
      rows.map((row) => [String(row.nombre), Number(row.total)]),
    );
  }
}

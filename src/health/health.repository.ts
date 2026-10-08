import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';

/** Lo que se espera a que MySQL conteste, en milisegundos. */
const TIMEOUT = 2000;

/**
 * Comprobación de que la base de datos responde.
 */
@Injectable()
export class HealthRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Hace la consulta más barata posible a MySQL.
   *
   * @returns `true` si contestó; `false` si no hay conexión, rechazó las
   * credenciales o tardó más de {@link TIMEOUT}.
   */
  async ping(): Promise<boolean> {
    try {
      // Si MySQL está colgado la consulta puede no regresar nunca: se deja
      // de esperar para que quien monitorea reciba su respuesta a tiempo.
      await Promise.race([
        this.pool.query('SELECT 1'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), TIMEOUT).unref(),
        ),
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

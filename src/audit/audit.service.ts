import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';

/** Acciones que se registran. Texto fijo: nunca datos del usuario. */
export type AuditAction =
  | 'LOGIN_OK'
  | 'LOGIN_FALLIDO'
  | 'LOGIN_BLOQUEADO'
  | 'LOGOUT'
  | 'PASSWORD_CAMBIADA'
  | 'CUENTA_EDITADA_POR_STAFF'
  | 'CUENTA_SUSPENDIDA'
  | 'ROL_CAMBIADO'
  | 'REPORTE_ESTADO_CAMBIADO'
  | 'REPORTE_RIESGO_CAMBIADO'
  | 'REPORTE_EXPORTADO'
  | 'REPORTE_ELIMINADO'
  | 'CUENTA_ELIMINADA'
  | 'ACCESO_DENEGADO';

/**
 * Bitácora de seguridad (`Auditoria`): quién hizo qué y cuándo, sin secretos.
 *
 * Un fallo al escribir la bitácora nunca tumba la petición: se registra en el
 * log del servidor y se sigue.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * @param action - Qué pasó.
   * @param options.userId - Quién lo hizo (`id_usuario`), si se sabe.
   * @param options.detail - Contexto corto (ids, estados). Sin contraseñas,
   * tokens ni textos libres del usuario.
   * @param options.ip - Dirección del cliente.
   */
  async log(
    action: AuditAction,
    options: {
      userId?: string | number | null;
      detail?: string;
      ip?: string;
    } = {},
  ): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO Auditoria (id_usuario, accion, detalle, ip) VALUES (?, ?, ?, ?)',
        [
          options.userId ?? null,
          action,
          // Una sola línea y acotada: evita forjar líneas en la bitácora.
          options.detail?.replace(/[\r\n\t]+/g, ' ').slice(0, 500) ?? null,
          options.ip?.slice(0, 45) ?? null,
        ],
      );
    } catch (error) {
      this.logger.error(
        `No se pudo escribir la bitácora (${action}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

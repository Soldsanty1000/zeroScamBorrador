/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { Notification } from './entities/notification.entity';

const COLUMNS =
  'n.id_notificacion, n.id_usuario, n.id_reporte, s.url_texto, n.mensaje, ' +
  'n.leido_estatus, n.fecha_envio';

// LEFT JOIN: solo las alertas de riesgo de una URL (RF08) traen `id_url`.
const FROM =
  'Notificacion_Alerta n LEFT JOIN SitioWeb_URL s ON s.id_url = n.id_url';

/**
 * Acceso a la tabla `Notificacion_Alerta`.
 *
 * @remarks
 * Las notificaciones se crean desde `ReportsRepository` (nuevo reporte,
 * cambio de estado) y `RiskRepository` (sube el riesgo de una URL); aquí
 * solo se leen y se marcan como leídas.
 */
@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Lista las notificaciones de un usuario, de la más reciente a la más
   * antigua.
   *
   * @param userId - `id_usuario` destinatario.
   * @param onlyUnread - `true` para traer solo las no leídas.
   */
  async findAll(userId: string, onlyUnread: boolean): Promise<Notification[]> {
    const unread = onlyUnread ? 'AND n.leido_estatus = FALSE' : '';
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM ${FROM}
       WHERE n.id_usuario = '${userId}' ${unread}
       ORDER BY n.fecha_envio DESC, n.id_notificacion DESC`,
    );
    return rows.map(toEntity);
  }

  /**
   * Marca como leída una notificación del usuario.
   *
   * @param id - `id_notificacion`.
   * @param userId - `id_usuario`; si no es el destinatario no se toca.
   * @returns La notificación, o `undefined` si no existe o no es suya.
   */
  async markRead(
    id: number,
    userId: string,
  ): Promise<Notification | undefined> {
    const [result] = await this.pool.query<ResultSetHeader>(
      `UPDATE Notificacion_Alerta SET leido_estatus = TRUE
       WHERE id_notificacion = ${id} AND id_usuario = '${userId}'`,
    );
    if (result.affectedRows === 0) return undefined;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE n.id_notificacion = ${id}`,
    );
    return toEntity(rows[0]);
  }
}

/**
 * Convierte una fila de MySQL en una entidad {@link Notification}.
 */
function toEntity(row: any): Notification {
  const notification = new Notification();
  notification.id = row.id_notificacion;
  notification.userId = String(row.id_usuario);
  notification.reportId = row.id_reporte ?? undefined;
  notification.url = row.url_texto ?? undefined;
  notification.message = row.mensaje;
  // MySQL guarda BOOLEAN como TINYINT: llega 0 o 1.
  notification.read = Boolean(row.leido_estatus);
  notification.sentAt = row.fecha_envio;
  return notification;
}

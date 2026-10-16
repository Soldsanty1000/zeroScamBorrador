import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

/** Lo que importa de un reporte bloqueado para decidir si se le puede operar. */
export interface LockedReport {
  /** `Reporte.id_estado`. */
  statusId: number;
  /** `Estado.nombre_estado`. */
  status: string;
  /** `Reporte.nivel_riesgo_asignado`. */
  riskLevel: string;
  /** `Reporte.id_usuario`, como texto. */
  ownerId: string;
}

/**
 * Bloquea la fila del reporte hasta que termine la transacción (`SELECT … FOR
 * UPDATE`) y regresa su estado ACTUAL.
 *
 * Es la base de las operaciones atómicas: cambiar de estado, borrar, editar
 * o adjuntar evidencia deciden con el estado que tiene el reporte en ese
 * instante, y nadie más puede cambiarlo hasta el `COMMIT`. Sin el bloqueo, un
 * "leer, comprobar y escribir" deja pasar a quien llegue en medio.
 *
 * Solo se bloquea `Reporte` (por llave primaria): el nombre del estado se lee
 * aparte, sin bloqueo, para no bloquear de paso las filas de `Estado`.
 *
 * @param conn - Conexión con una transacción abierta.
 * @param id - `id_reporte`.
 * @returns El reporte, o `undefined` si no existe.
 */
export async function lockReport(
  conn: PoolConnection,
  id: number,
): Promise<LockedReport | undefined> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id_estado, id_usuario, nivel_riesgo_asignado
     FROM Reporte WHERE id_reporte = ? FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  if (!row) return undefined;
  const [states] = await conn.query<RowDataPacket[]>(
    'SELECT nombre_estado FROM Estado WHERE id_estado = ?',
    [row.id_estado],
  );
  return {
    statusId: Number(row.id_estado),
    status: String(states[0].nombre_estado),
    riskLevel: String(row.nivel_riesgo_asignado),
    ownerId: String(row.id_usuario),
  };
}

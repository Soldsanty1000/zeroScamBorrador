import { BadRequestException } from '@nestjs/common';
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';

/**
 * Cabecera opcional `Idempotency-Key` al crear reportes (IOS-L15). La app de
 * iOS reintenta un POST cuando la red se corta antes de ver la respuesta; sin
 * esta clave, el reintento duplicaría el reporte (y gastaría cuota). Con ella,
 * la misma clave del mismo usuario regresa el reporte que ya se creó.
 *
 * La clave se guarda en `Reporte_Idempotencia (id_usuario, clave)`, con el
 * reporte que creó. Es por usuario: la clave de otra persona no sirve ni
 * choca. Caduca a las {@link IDEMPOTENCY_HOURS} horas.
 */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** Horas que una clave sigue valiendo. */
export const IDEMPOTENCY_HOURS = 24;

/** De 8 a 64 caracteres: letras, números, guion y guion bajo. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Valida el valor de la cabecera. Sin cabecera no pasa nada (`undefined`): el
 * comportamiento de siempre.
 *
 * @param raw - Valor de `req.headers['idempotency-key']`.
 * @throws {@link BadRequestException} si viene pero no cumple el formato.
 */
export function parseIdempotencyKey(
  raw: string | string[] | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  // Una cabecera repetida llega unida con comas (o como arreglo) y no pasa el
  // patrón: una sola clave por petición.
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new BadRequestException(
      `${IDEMPOTENCY_HEADER} debe tener de 8 a 64 caracteres: letras, ` +
        'números, guion o guion bajo',
    );
  }
  return value;
}

/**
 * Reserva la clave para esta petición, dentro de la transacción de la
 * creación.
 *
 * - Clave nueva (o caducada): queda reservada y regresa `undefined`; quien
 *   llama crea el reporte y lo liga con {@link bindIdempotencyKey}.
 * - Clave ya usada por este usuario: regresa el `id_reporte` que se creó y
 *   quien llama NO crea nada (ni gasta cuota ni avisa a nadie).
 *
 * Dos peticiones simultáneas con la misma clave no duplican: el `INSERT` de la
 * segunda espera a que la primera confirme (o deshaga) y entonces ve su fila.
 *
 * @param conn - Conexión con una transacción abierta.
 * @param userId - `id_usuario` de quien crea.
 * @param key - Clave ya validada con {@link parseIdempotencyKey}.
 */
export async function claimIdempotencyKey(
  conn: PoolConnection,
  userId: string | number,
  key: string,
): Promise<number | undefined> {
  // Solo esta clave, y solo si caducó: se libera para reutilizarla.
  await conn.query(
    `DELETE FROM Reporte_Idempotencia
     WHERE id_usuario = ? AND clave = ? AND creada < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
    [userId, key, IDEMPOTENCY_HOURS],
  );
  const [claimed] = await conn.query<ResultSetHeader>(
    'INSERT IGNORE INTO Reporte_Idempotencia (id_usuario, clave) VALUES (?, ?)',
    [userId, key],
  );
  if (claimed.affectedRows === 1) return undefined;
  // La clave ya existía: el reporte que creó es la respuesta. Lectura con
  // bloqueo para ver lo último confirmado y no una instantánea vieja.
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id_reporte FROM Reporte_Idempotencia
     WHERE id_usuario = ? AND clave = ? FOR UPDATE`,
    [userId, key],
  );
  const reportId = rows[0]?.id_reporte as number | string | null | undefined;
  return reportId === null || reportId === undefined
    ? undefined
    : Number(reportId);
}

/** Liga la clave reservada con el reporte que se acaba de crear. */
export async function bindIdempotencyKey(
  conn: PoolConnection,
  userId: string | number,
  key: string,
  reportId: number,
): Promise<void> {
  await conn.query(
    'UPDATE Reporte_Idempotencia SET id_reporte = ? WHERE id_usuario = ? AND clave = ?',
    [reportId, userId, key],
  );
}

/**
 * Borra las claves caducadas. Va fuera de la transacción de la creación y un
 * fallo aquí nunca afecta a quien creó el reporte.
 */
export async function pruneIdempotencyKeys(pool: Pool): Promise<void> {
  try {
    await pool.query(
      'DELETE FROM Reporte_Idempotencia WHERE creada < DATE_SUB(NOW(), INTERVAL ? HOUR)',
      [IDEMPOTENCY_HOURS],
    );
  } catch {
    // Es limpieza: la clave caducada ya no se honra (ver claimIdempotencyKey).
  }
}

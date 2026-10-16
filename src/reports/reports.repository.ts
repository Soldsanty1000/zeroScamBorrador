/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { Report, ReportHistoryEntry } from './entities/report.entity';
import { lockReport } from './report-locks';
import {
  REPORT_QUOTA_MESSAGE,
  REPORT_QUOTA_WHERE,
  canTransition,
  invalidTransition,
  notDeletable,
  quotaError,
  reportQuotaExceeded,
  reportQuotaParams,
  statusChanged,
} from './report-rules';

// COLUMNS y FROM son constantes del propio archivo: se interpolan en el SQL
// porque no llevan ningún dato externo. Todo valor externo va como `?`.
const COLUMNS =
  'r.id_reporte, r.id_usuario, r.id_tipo_fraude, t.nombre_tipo, e.nombre_estado, ' +
  'r.descripcion_incidente, r.fecha_incidente, r.nivel_riesgo_asignado, r.fecha_creacion, ' +
  'r.es_anonimo';

const FROM =
  'Reporte r JOIN Estado e ON e.id_estado = r.id_estado ' +
  'JOIN TipoFraude t ON t.id_tipo_fraude = r.id_tipo_fraude';

/**
 * Tope duro de filas que regresa {@link ReportsRepository.findAll}. Sin él,
 * un listado sin filtros (o con uno muy amplio) cargaría toda la tabla en
 * memoria. Quien necesite más acota con los filtros (`from`/`to`, `status`…).
 */
export const MAX_LIST_RESULTS = 500;

/** Una URL de un reporte con el riesgo que tiene en `SitioWeb_URL`. */
export interface ReportUrlDetail {
  url: string;
  riskLevel: string;
  certificateStatus: string | undefined;
  lastEvaluatedAt: Date | undefined;
}

/** Una fila de `Evidencia`. */
export interface ReportEvidenceDetail {
  /** `ruta_archivo`: nombre del archivo dentro de uploads/. */
  fileName: string;
  mimeType: string;
  uploadedAt: Date;
}

/** Filtros de {@link ReportsRepository.findAll}; los ausentes no filtran. */
export interface ReportQuery {
  ownerId?: string;
  /** Limita a estos estados (p. ej. lo que puede ver la Policía). */
  statuses?: string[];
  status?: string;
  fraudTypeId?: number;
  from?: Date;
  to?: Date;
  q?: string;
}

/**
 * Acceso a `Reporte` y sus tablas relacionadas: `SitioWeb_URL`,
 * `Reporte_URL`, `Evidencia`, `Historial_Estado` y `Notificacion_Alerta`.
 *
 * @remarks
 * Es la única capa que escribe SQL de reportes. Regresa entidades
 * {@link Report}, nunca filas crudas ni DTOs.
 */
@Injectable()
export class ReportsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Busca un reporte por id, sin importar su dueño, con sus URLs y
   * evidencias.
   *
   * @param id - `id_reporte`.
   * @returns El reporte, o `undefined` si no existe.
   */
  async findById(id: number): Promise<Report | undefined> {
    assertInteger(id, 'id');
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE r.id_reporte = ?`,
      [id],
    );
    if (!rows[0]) return undefined;
    return (await this.withRelations([toEntity(rows[0])]))[0];
  }

  /**
   * Lista reportes con filtros, del más reciente al más antiguo. Regresa a lo
   * más {@link MAX_LIST_RESULTS} (los más recientes).
   *
   * @param query - Filtros; ver {@link ReportQuery}.
   * @returns Los reportes con sus URLs y evidencias; vacío si no hay.
   */
  async findAll(query: ReportQuery): Promise<Report[]> {
    // Los fragmentos de `where` son texto fijo con marcadores `?`; los valores
    // viajan aparte, en `params`, en el mismo orden.
    const where = ['1 = 1'];
    const params: unknown[] = [];
    if (query.ownerId) {
      where.push('r.id_usuario = ?');
      params.push(query.ownerId);
    }
    if (query.statuses) {
      if (query.statuses.length > 0) {
        // mysql2 expande el arreglo de `IN (?)` en 'a', 'b', ...
        where.push('e.nombre_estado IN (?)');
        params.push(query.statuses);
      } else {
        // `IN ()` es error de sintaxis: sin estados permitidos no se ve nada.
        where.push('1 = 0');
      }
    }
    if (query.status) {
      where.push('e.nombre_estado = ?');
      params.push(query.status);
    }
    if (query.fraudTypeId) {
      assertInteger(query.fraudTypeId, 'fraudTypeId');
      where.push('r.id_tipo_fraude = ?');
      params.push(query.fraudTypeId);
    }
    if (query.from) {
      where.push('r.fecha_creacion >= ?');
      params.push(toMysqlDate(query.from));
    }
    if (query.to) {
      where.push('r.fecha_creacion <= ?');
      params.push(toMysqlDate(query.to));
    }
    if (query.q) {
      where.push('r.descripcion_incidente LIKE ?');
      params.push(`%${escapeLike(query.q)}%`);
    }
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE ${where.join(' AND ')}
       ORDER BY r.fecha_creacion DESC, r.id_reporte DESC
       LIMIT ?`,
      [...params, MAX_LIST_RESULTS],
    );
    return this.withRelations(rows.map(toEntity));
  }

  /**
   * Historial de cambios de estado de un reporte (`Historial_Estado`).
   *
   * @param id - `id_reporte`.
   * @returns Los cambios del más antiguo al más reciente.
   */
  async findHistory(id: number): Promise<ReportHistoryEntry[]> {
    assertInteger(id, 'id');
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ea.nombre_estado AS anterior, en.nombre_estado AS nuevo,
              h.observaciones, h.fecha_cambio
       FROM Historial_Estado h
       LEFT JOIN Estado ea ON ea.id_estado = h.id_estado_anterior
       JOIN Estado en ON en.id_estado = h.id_estado_nuevo
       WHERE h.id_reporte = ? ORDER BY h.fecha_cambio, h.id_historial`,
      [id],
    );
    return rows.map((row) => {
      const entry = new ReportHistoryEntry();
      entry.fromStatus = row.anterior ?? undefined;
      entry.toStatus = row.nuevo;
      entry.observations = row.observaciones ?? undefined;
      entry.changedAt = row.fecha_cambio;
      return entry;
    });
  }

  /**
   * URLs de un reporte con su riesgo global y el estado de su certificado,
   * para el expediente que se exporta.
   *
   * @param id - `id_reporte`.
   */
  async findUrlDetails(id: number): Promise<ReportUrlDetail[]> {
    assertInteger(id, 'id');
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT s.url_texto, s.nivel_riesgo_global, s.estado_certificado, s.fecha_ultima_evaluacion
       FROM Reporte_URL ru JOIN SitioWeb_URL s ON s.id_url = ru.id_url
       WHERE ru.id_reporte = ? ORDER BY ru.fecha_asociacion, s.id_url`,
      [id],
    );
    return rows.map((row) => ({
      url: row.url_texto,
      riskLevel: row.nivel_riesgo_global,
      certificateStatus: row.estado_certificado ?? undefined,
      lastEvaluatedAt: row.fecha_ultima_evaluacion ?? undefined,
    }));
  }

  /**
   * Evidencias de un reporte con su tipo y fecha de carga, para el
   * expediente que se exporta.
   *
   * @param id - `id_reporte`.
   */
  async findEvidenceDetails(id: number): Promise<ReportEvidenceDetail[]> {
    assertInteger(id, 'id');
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ruta_archivo, tipo_archivo, fecha_carga FROM Evidencia
       WHERE id_reporte = ? ORDER BY fecha_carga, id_evidencia`,
      [id],
    );
    return rows.map((row) => ({
      fileName: row.ruta_archivo,
      mimeType: row.tipo_archivo,
      uploadedAt: row.fecha_carga,
    }));
  }

  /**
   * Inserta un reporte nuevo en estado RECIBIDO, con sus URLs, avisa a los
   * administradores (CU16) y lo regresa tal como quedó en la base.
   *
   * @remarks
   * Aplica la cuota diaria de reportes (la misma que `/community`, ver
   * {@link REPORT_QUOTA_WHERE}) DENTRO del propio INSERT: cuenta e inserta en
   * una sola sentencia, así que dos peticiones simultáneas no pueden pasarse
   * del tope.
   *
   * @param ownerId - `id_usuario` de quien levanta el reporte.
   * @param report - Tipo de fraude, descripción, fecha del incidente y URLs.
   * @returns El reporte recién guardado; `nivel_riesgo_asignado` y
   * `fecha_creacion` los pone MySQL con sus DEFAULT.
   * @throws HttpException 429 si ya creó el máximo de reportes en 24 horas.
   */
  async save(
    ownerId: string,
    report: Pick<
      Report,
      'fraudTypeId' | 'description' | 'incidentDate' | 'urls'
    >,
  ): Promise<Report> {
    assertInteger(report.fraudTypeId!, 'fraudTypeId');
    // Reporte, URLs y avisos van en una transacción: un reporte sin URLs
    // rompería la cardinalidad 1..N de Reporte_URL.
    const id = await this.transaction(async (conn) => {
      // `id_reporte` es AUTO_INCREMENT: MySQL lo regresa en `insertId`. Si la
      // cuota ya se agotó el SELECT no devuelve filas y no se inserta nada.
      let result: ResultSetHeader;
      try {
        [result] = await conn.query<ResultSetHeader>(
          `INSERT INTO Reporte (id_usuario, id_tipo_fraude, id_estado, descripcion_incidente, fecha_incidente)
           SELECT ?, ?, (SELECT id_estado FROM Estado WHERE nombre_estado = 'RECIBIDO'), ?, ?
           FROM DUAL ${REPORT_QUOTA_WHERE}`,
          [
            ownerId,
            report.fraudTypeId,
            report.description,
            toMysqlDate(report.incidentDate!),
            ...reportQuotaParams(ownerId),
          ],
        );
      } catch (err) {
        throw quotaError(err, REPORT_QUOTA_MESSAGE);
      }
      if (result.affectedRows === 0) throw reportQuotaExceeded();
      await linkUrls(conn, result.insertId, report.urls!);
      // CU16: cada Administrador y Owner recibe el nuevo ticket en su bandeja.
      await conn.query(
        `INSERT INTO Notificacion_Alerta (id_usuario, id_reporte, mensaje)
         SELECT u.id_usuario, ?, ?
         FROM Usuario u JOIN Rol ro ON ro.id_rol = u.id_rol
         WHERE ro.nombre_rol IN ('Administrador', 'Owner') AND u.estado_cuenta = 'ACTIVO'`,
        [result.insertId, `Nuevo reporte #${result.insertId} por revisar`],
      );
      return result.insertId;
    });
    return (await this.findById(id))!;
  }

  /**
   * Actualiza solo los campos presentes en `changes`. Si vienen `urls`,
   * reemplazan a las anteriores.
   *
   * @remarks
   * Solo se edita en RECIBIDO, y se comprueba DENTRO de la transacción con la
   * fila bloqueada: si un administrador lo pasó a revisión entre que el
   * servicio lo leyó y este UPDATE, la edición se rechaza en vez de colarse.
   *
   * @param id - `id_reporte`.
   * @param changes - Campos a modificar; los ausentes no se tocan.
   * @returns El reporte después del cambio.
   * @throws {@link NotFoundException} si ya no existe.
   * @throws {@link ConflictException} si ya no está en RECIBIDO.
   */
  async update(
    id: number,
    changes: Partial<
      Pick<Report, 'fraudTypeId' | 'description' | 'incidentDate' | 'urls'>
    >,
  ): Promise<Report | undefined> {
    assertInteger(id, 'id');
    // `sets` solo guarda fragmentos fijos "columna = ?"; los valores van en
    // `params`, en el mismo orden.
    const sets: string[] = [];
    const params: unknown[] = [];
    if (changes.fraudTypeId !== undefined) {
      assertInteger(changes.fraudTypeId, 'fraudTypeId');
      sets.push('id_tipo_fraude = ?');
      params.push(changes.fraudTypeId);
    }
    if (changes.description !== undefined) {
      sets.push('descripcion_incidente = ?');
      params.push(changes.description);
    }
    if (changes.incidentDate !== undefined) {
      sets.push('fecha_incidente = ?');
      params.push(toMysqlDate(changes.incidentDate));
    }
    await this.transaction(async (conn) => {
      const current = await lockReport(conn, id);
      if (!current) throw notFound(id);
      if (current.status !== 'RECIBIDO') {
        throw new ConflictException(
          'El reporte ya está en ' +
            current.status +
            ' y no se puede modificar',
        );
      }
      // Sin campos no hay UPDATE: MySQL rechaza un SET vacío.
      if (sets.length > 0) {
        await conn.query(
          `UPDATE Reporte SET ${sets.join(', ')} WHERE id_reporte = ?`,
          [...params, id],
        );
      }
      if (changes.urls) {
        await conn.query('DELETE FROM Reporte_URL WHERE id_reporte = ?', [id]);
        await linkUrls(conn, id, changes.urls);
      }
    });
    return this.findById(id);
  }

  /**
   * Borra un reporte y todo lo que cuelga de él, si está en uno de los
   * estados `allowed`.
   *
   * @remarks
   * El estado se comprueba DENTRO de la transacción con la fila bloqueada, no
   * antes: así un reporte que acaba de pasar a revisión o validarse ya no se
   * puede borrar aunque la petición haya llegado "a tiempo". Borrar un
   * reporte VALIDADO, EN_REVISION o CANALIZADO destruiría la cadena de
   * custodia.
   *
   * @param id - `id_reporte`.
   * @param allowed - Estados en los que se permite el borrado.
   * @returns El estado que tenía y los nombres de archivo de sus evidencias,
   * para borrarlos del disco.
   * @throws {@link NotFoundException} si no existe.
   * @throws {@link ConflictException} si su estado no está en `allowed`.
   */
  async delete(
    id: number,
    allowed: readonly string[],
  ): Promise<{ status: string; files: string[] }> {
    assertInteger(id, 'id');
    return this.transaction(async (conn) => {
      const current = await lockReport(conn, id);
      if (!current) throw notFound(id);
      if (!allowed.includes(current.status)) {
        throw notDeletable(current.status, allowed);
      }
      const [evidence] = await conn.query<RowDataPacket[]>(
        'SELECT ruta_archivo FROM Evidencia WHERE id_reporte = ?',
        [id],
      );
      // Primero los hijos: las llaves foráneas no tienen ON DELETE CASCADE.
      // Los nombres de tabla salen de esta lista fija (los identificadores no
      // se pueden parametrizar); nunca vienen de entrada de usuario.
      for (const table of [
        'Notificacion_Alerta',
        'Historial_Estado',
        'Evidencia',
        'Reporte_URL',
        'Reporte',
      ]) {
        await conn.query(`DELETE FROM ${table} WHERE id_reporte = ?`, [id]);
      }
      return {
        status: current.status,
        files: evidence.map((row) => String(row.ruta_archivo)),
      };
    });
  }

  /**
   * Cambia el estado de un reporte (CU19, CU20): lo registra en
   * `Historial_Estado` y avisa al denunciante.
   *
   * @remarks
   * Es atómico: bloquea la fila (`SELECT … FOR UPDATE`) y, con ella
   * bloqueada, comprueba que el estado siga siendo el que quien llama vio
   * (`expectedStatus`) y que la transición esté permitida (ver
   * `STATUS_TRANSITIONS`). El UPDATE además va condicionado al estado leído.
   * Dos administradores que actúan a la vez no pueden pisarse: el segundo
   * recibe un 409.
   *
   * El riesgo de sus URLs no se recalcula aquí: lo hace
   * `RiskService.refreshUrls`, que `ReportsService` llama después.
   *
   * @param id - `id_reporte`.
   * @param adminId - `id_usuario` del administrador que hace el cambio.
   * @param expectedStatus - Estado con el que quien llama validó la transición.
   * @param status - Estado nuevo (`nombre_estado`).
   * @param observations - Dictamen o motivo; puede no venir.
   * @returns El reporte después del cambio.
   * @throws {@link NotFoundException} si ya no existe.
   * @throws {@link ConflictException} si el estado cambió o la transición no
   * está permitida.
   */
  async changeStatus(
    id: number,
    adminId: string,
    expectedStatus: string,
    status: string,
    observations: string | undefined,
  ): Promise<Report> {
    assertInteger(id, 'id');
    // Sin observaciones (o vacías) se guarda NULL; mysql2 convierte null en NULL.
    const obs = observations ? observations : null;
    await this.transaction(async (conn) => {
      const current = await lockReport(conn, id);
      if (!current) throw notFound(id);
      if (current.status !== expectedStatus) {
        throw statusChanged(expectedStatus, current.status);
      }
      if (!canTransition(current.status, status)) {
        throw invalidTransition(current.status, status);
      }
      const [updated] = await conn.query<ResultSetHeader>(
        `UPDATE Reporte SET id_estado = (SELECT id_estado FROM Estado WHERE nombre_estado = ?)
         WHERE id_reporte = ? AND id_estado = ?`,
        [status, id, current.statusId],
      );
      if (updated.affectedRows !== 1) {
        throw statusChanged(expectedStatus, 'otro distinto');
      }
      await conn.query(
        `INSERT INTO Historial_Estado (id_reporte, id_admin_responsable, id_estado_anterior, id_estado_nuevo, observaciones)
         VALUES (?, ?, ?, (SELECT id_estado FROM Estado WHERE nombre_estado = ?), ?)`,
        [id, adminId, current.statusId, status, obs],
      );
      // RF06: el denunciante se entera del cambio. El mensaje lleva texto del
      // administrador, así que va como parámetro y no pegado al SQL.
      const message =
        `Tu reporte #${id} cambió a ${status}` +
        (observations ? `: ${observations}` : '');
      await conn.query(
        `INSERT INTO Notificacion_Alerta (id_usuario, id_reporte, mensaje)
         SELECT id_usuario, id_reporte, ? FROM Reporte WHERE id_reporte = ?`,
        [message, id],
      );
    });
    return (await this.findById(id))!;
  }

  /**
   * Asigna el nivel de riesgo de un reporte (CU18) y deja constancia en
   * `Historial_Estado` (sin cambiar el estado).
   *
   * @remarks
   * Un reporte RECHAZADO no se reclasifica: ya no cuenta para el riesgo de
   * sus URLs y su dictamen es final. Se comprueba con la fila bloqueada.
   *
   * @param id - `id_reporte`.
   * @param adminId - `id_usuario` del administrador.
   * @param riskLevel - BAJO, MEDIO, ALTO o MUY_ALTO.
   * @returns El reporte después del cambio y el nivel que tenía antes.
   * @throws {@link NotFoundException} si ya no existe.
   * @throws {@link ConflictException} si el reporte está RECHAZADO.
   */
  async setRisk(
    id: number,
    adminId: string,
    riskLevel: string,
  ): Promise<{ report: Report; previousRiskLevel: string }> {
    assertInteger(id, 'id');
    const previousRiskLevel = await this.transaction(async (conn) => {
      const current = await lockReport(conn, id);
      if (!current) throw notFound(id);
      if (current.status === 'RECHAZADO') {
        throw new ConflictException(
          'El reporte está RECHAZADO y no se puede reclasificar',
        );
      }
      await conn.query(
        'UPDATE Reporte SET nivel_riesgo_asignado = ? WHERE id_reporte = ?',
        [riskLevel, id],
      );
      // Log de auditoría: mismo estado antes y después, el cambio va en
      // observaciones.
      await conn.query(
        `INSERT INTO Historial_Estado (id_reporte, id_admin_responsable, id_estado_anterior, id_estado_nuevo, observaciones)
         VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          adminId,
          current.statusId,
          current.statusId,
          `Nivel de riesgo: ${riskLevel}`,
        ],
      );
      return current.riskLevel;
    });
    return { report: (await this.findById(id))!, previousRiskLevel };
  }

  /**
   * Registra un archivo de evidencia de un reporte.
   *
   * @remarks
   * Solo en RECIBIDO y hasta `maxEvidence` archivos, comprobado con la fila
   * bloqueada: ni una evidencia nueva se cuela en un reporte que ya se empezó
   * a revisar, ni dos subidas simultáneas rebasan el tope.
   *
   * @param id - `id_reporte`.
   * @param filename - Nombre del archivo dentro de `uploads/`.
   * @param mimeType - Tipo del archivo, p. ej. `image/png`.
   * @param maxEvidence - Máximo de evidencias por reporte.
   * @returns El reporte con la evidencia agregada.
   * @throws {@link NotFoundException} si no existe.
   * @throws {@link ConflictException} si ya no está en RECIBIDO.
   * @throws {@link BadRequestException} si ya tiene el máximo de evidencias.
   */
  async addEvidence(
    id: number,
    filename: string,
    mimeType: string,
    maxEvidence: number,
  ): Promise<Report | undefined> {
    assertInteger(id, 'id');
    await this.transaction(async (conn) => {
      const current = await lockReport(conn, id);
      if (!current) throw notFound(id);
      if (current.status !== 'RECIBIDO') {
        throw new ConflictException(
          'El reporte ya está en ' +
            current.status +
            ' y no se puede modificar',
        );
      }
      const [count] = await conn.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM Evidencia WHERE id_reporte = ?',
        [id],
      );
      if (Number(count[0].total) >= maxEvidence) {
        throw new BadRequestException(
          `Máximo ${maxEvidence} archivos de evidencia por reporte.`,
        );
      }
      await conn.query(
        `INSERT INTO Evidencia (id_reporte, ruta_archivo, tipo_archivo)
         VALUES (?, ?, ?)`,
        [id, filename, mimeType],
      );
    });
    return this.findById(id);
  }

  /**
   * Carga URLs y evidencias de varios reportes con una consulta por tabla,
   * en vez de dos por reporte.
   */
  private async withRelations(reports: Report[]): Promise<Report[]> {
    if (reports.length === 0) return reports;
    // Arreglo no vacío (se descartó arriba): mysql2 expande `IN (?)`.
    const ids = reports.map((r) => r.id);
    const [urls] = await this.pool.query<RowDataPacket[]>(
      `SELECT ru.id_reporte, s.url_texto FROM Reporte_URL ru
       JOIN SitioWeb_URL s ON s.id_url = ru.id_url
       WHERE ru.id_reporte IN (?) ORDER BY ru.fecha_asociacion, s.id_url`,
      [ids],
    );
    const [evidence] = await this.pool.query<RowDataPacket[]>(
      `SELECT id_reporte, ruta_archivo FROM Evidencia
       WHERE id_reporte IN (?) ORDER BY fecha_carga, id_evidencia`,
      [ids],
    );
    for (const report of reports) {
      report.urls = urls
        .filter((u) => u.id_reporte === report.id)
        .map((u) => u.url_texto);
      report.evidence = evidence
        .filter((e) => e.id_reporte === report.id)
        .map((e) => e.ruta_archivo);
    }
    return reports;
  }

  /**
   * Corre `work` dentro de una transacción; si algo falla, deshace todo.
   */
  private async transaction<T>(
    work: (conn: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

/** El 404 de un reporte que no existe (o que se borró mientras se operaba). */
function notFound(id: number): NotFoundException {
  return new NotFoundException('Reporte ' + id + ' no encontrado');
}

/**
 * Liga URLs a un reporte, creándolas en `SitioWeb_URL` si no existían.
 */
async function linkUrls(
  conn: PoolConnection,
  id: number,
  urls: string[],
): Promise<void> {
  // Set para no ligar dos veces la misma URL (la PK de Reporte_URL lo
  // rechazaría).
  for (const url of new Set(urls)) {
    // Cada URL existe una sola vez en SitioWeb_URL. Si ya estaba,
    // LAST_INSERT_ID(id_url) hace que `insertId` traiga el id existente.
    const [site] = await conn.query<ResultSetHeader>(
      `INSERT INTO SitioWeb_URL (url_texto) VALUES (?)
       ON DUPLICATE KEY UPDATE id_url = LAST_INSERT_ID(id_url)`,
      [url],
    );
    await conn.query(
      'INSERT INTO Reporte_URL (id_reporte, id_url) VALUES (?, ?)',
      [id, site.insertId],
    );
  }
}

/**
 * 'sv-SE' da 'YYYY-MM-DD HH:MM:SS' en hora local, el formato que MySQL acepta
 * en un DATETIME y la misma zona con la que mysql2 lo relee.
 */
function toMysqlDate(date: Date): string {
  return date.toLocaleString('sv-SE');
}

/**
 * Exige que un valor numérico sea un entero antes de mandarlo a MySQL.
 *
 * @param value - Id o clave numérica recibida.
 * @param name - Nombre del dato, para el mensaje de error.
 * @throws {@link BadRequestException} si no es un entero.
 */
function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new BadRequestException(name + ' debe ser un número entero');
  }
}

/**
 * Escapa `\`, `%` y `_` para que el texto del usuario se busque tal cual en
 * un `LIKE`, sin que actúen como comodines.
 */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

/**
 * Convierte una fila de MySQL en una entidad {@link Report}, sin URLs ni
 * evidencias.
 *
 * @param row - Fila con las columnas de `COLUMNS`.
 * @returns La entidad con los nombres de campo en camelCase.
 */
function toEntity(row: any): Report {
  const report = new Report();
  report.id = row.id_reporte;
  report.ownerId = String(row.id_usuario);
  report.fraudTypeId = row.id_tipo_fraude;
  report.fraudType = row.nombre_tipo;
  report.status = row.nombre_estado;
  report.description = row.descripcion_incidente;
  report.incidentDate = row.fecha_incidente;
  report.riskLevel = row.nivel_riesgo_asignado;
  report.createdAt = row.fecha_creacion;
  report.anonymous = Boolean(row.es_anonimo);
  return report;
}

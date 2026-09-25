/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Inject, Injectable } from '@nestjs/common';
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { Report, ReportHistoryEntry } from './entities/report.entity';

const COLUMNS =
  'r.id_reporte, r.id_usuario, r.id_tipo_fraude, t.nombre_tipo, e.nombre_estado, ' +
  'r.descripcion_incidente, r.fecha_incidente, r.nivel_riesgo_asignado, r.fecha_creacion';

const FROM =
  'Reporte r JOIN Estado e ON e.id_estado = r.id_estado ' +
  'JOIN TipoFraude t ON t.id_tipo_fraude = r.id_tipo_fraude';

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
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE r.id_reporte = ${id}`,
    );
    if (!rows[0]) return undefined;
    return (await this.withRelations([toEntity(rows[0])]))[0];
  }

  /**
   * Lista reportes con filtros, del más reciente al más antiguo.
   *
   * @param query - Filtros; ver {@link ReportQuery}.
   * @returns Los reportes con sus URLs y evidencias; vacío si no hay.
   */
  async findAll(query: ReportQuery): Promise<Report[]> {
    const where = ['1 = 1'];
    if (query.ownerId) where.push(`r.id_usuario = '${query.ownerId}'`);
    if (query.statuses) {
      where.push(
        `e.nombre_estado IN (${query.statuses.map((s) => `'${s}'`).join(', ')})`,
      );
    }
    if (query.status) where.push(`e.nombre_estado = '${query.status}'`);
    if (query.fraudTypeId) {
      where.push(`r.id_tipo_fraude = ${query.fraudTypeId}`);
    }
    if (query.from) {
      where.push(`r.fecha_creacion >= '${toMysqlDate(query.from)}'`);
    }
    if (query.to) where.push(`r.fecha_creacion <= '${toMysqlDate(query.to)}'`);
    if (query.q) where.push(`r.descripcion_incidente LIKE '%${query.q}%'`);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE ${where.join(' AND ')}
       ORDER BY r.fecha_creacion DESC, r.id_reporte DESC`,
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
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ea.nombre_estado AS anterior, en.nombre_estado AS nuevo,
              h.observaciones, h.fecha_cambio
       FROM Historial_Estado h
       LEFT JOIN Estado ea ON ea.id_estado = h.id_estado_anterior
       JOIN Estado en ON en.id_estado = h.id_estado_nuevo
       WHERE h.id_reporte = ${id} ORDER BY h.fecha_cambio, h.id_historial`,
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
   * Dice si un estado es final (`Estado.es_final`): de ahí ya no se mueve.
   *
   * @param status - `nombre_estado`.
   */
  async isFinalStatus(status: string): Promise<boolean> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT es_final FROM Estado WHERE nombre_estado = '${status}'`,
    );
    return Boolean(rows[0]?.es_final);
  }

  /**
   * Inserta un reporte nuevo en estado RECIBIDO, con sus URLs, avisa a los
   * administradores (CU16) y lo regresa tal como quedó en la base.
   *
   * @param ownerId - `id_usuario` de quien levanta el reporte.
   * @param report - Tipo de fraude, descripción, fecha del incidente y URLs.
   * @returns El reporte recién guardado; `nivel_riesgo_asignado` y
   * `fecha_creacion` los pone MySQL con sus DEFAULT.
   */
  async save(
    ownerId: string,
    report: Pick<
      Report,
      'fraudTypeId' | 'description' | 'incidentDate' | 'urls'
    >,
  ): Promise<Report> {
    // Reporte, URLs y avisos van en una transacción: un reporte sin URLs
    // rompería la cardinalidad 1..N de Reporte_URL.
    const id = await this.transaction(async (conn) => {
      // `id_reporte` es AUTO_INCREMENT: MySQL lo regresa en `insertId`.
      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO Reporte (id_usuario, id_tipo_fraude, id_estado, descripcion_incidente, fecha_incidente)
         VALUES ('${ownerId}', ${report.fraudTypeId},
                 (SELECT id_estado FROM Estado WHERE nombre_estado = 'RECIBIDO'),
                 '${report.description}', '${toMysqlDate(report.incidentDate!)}')`,
      );
      await linkUrls(conn, result.insertId, report.urls!);
      // CU16: cada Administrador y Owner recibe el nuevo ticket en su bandeja.
      await conn.query(
        `INSERT INTO Notificacion_Alerta (id_usuario, id_reporte, mensaje)
         SELECT u.id_usuario, ${result.insertId}, 'Nuevo reporte #${result.insertId} por revisar'
         FROM Usuario u JOIN Rol ro ON ro.id_rol = u.id_rol
         WHERE ro.nombre_rol IN ('Administrador', 'Owner') AND u.estado_cuenta = 'ACTIVO'`,
      );
      return result.insertId;
    });
    return (await this.findById(id))!;
  }

  /**
   * Actualiza solo los campos presentes en `changes`. Si vienen `urls`,
   * reemplazan a las anteriores.
   *
   * @param id - `id_reporte`.
   * @param changes - Campos a modificar; los ausentes no se tocan.
   * @returns El reporte después del cambio, o `undefined` si no existe.
   */
  async update(
    id: number,
    changes: Partial<
      Pick<Report, 'fraudTypeId' | 'description' | 'incidentDate' | 'urls'>
    >,
  ): Promise<Report | undefined> {
    const sets: string[] = [];
    if (changes.fraudTypeId !== undefined) {
      sets.push(`id_tipo_fraude = ${changes.fraudTypeId}`);
    }
    if (changes.description !== undefined) {
      sets.push(`descripcion_incidente = '${changes.description}'`);
    }
    if (changes.incidentDate !== undefined) {
      sets.push(`fecha_incidente = '${toMysqlDate(changes.incidentDate)}'`);
    }
    await this.transaction(async (conn) => {
      // Sin campos no hay UPDATE: MySQL rechaza un SET vacío.
      if (sets.length > 0) {
        await conn.query(
          `UPDATE Reporte SET ${sets.join(', ')} WHERE id_reporte = ${id}`,
        );
      }
      if (changes.urls) {
        await conn.query(`DELETE FROM Reporte_URL WHERE id_reporte = ${id}`);
        await linkUrls(conn, id, changes.urls);
      }
    });
    return this.findById(id);
  }

  /**
   * Borra un reporte y todo lo que cuelga de él.
   *
   * @param id - `id_reporte`.
   * @returns Los nombres de archivo de sus evidencias, para borrarlos del
   * disco.
   */
  async delete(id: number): Promise<string[]> {
    const report = await this.findById(id);
    await this.transaction(async (conn) => {
      // Primero los hijos: las llaves foráneas no tienen ON DELETE CASCADE.
      for (const table of [
        'Notificacion_Alerta',
        'Historial_Estado',
        'Evidencia',
        'Reporte_URL',
        'Reporte',
      ]) {
        await conn.query(`DELETE FROM ${table} WHERE id_reporte = ${id}`);
      }
    });
    return report?.evidence ?? [];
  }

  /**
   * Cambia el estado de un reporte (CU19, CU20): lo registra en
   * `Historial_Estado`, avisa al denunciante y recalcula el riesgo de sus
   * URLs.
   *
   * @param id - `id_reporte`.
   * @param adminId - `id_usuario` del administrador que hace el cambio.
   * @param status - Estado nuevo (`nombre_estado`).
   * @param observations - Dictamen o motivo; puede no venir.
   * @returns El reporte después del cambio.
   */
  async changeStatus(
    id: number,
    adminId: string,
    status: string,
    observations: string | undefined,
  ): Promise<Report> {
    const obs = observations ? `'${observations}'` : 'NULL';
    await this.transaction(async (conn) => {
      // El historial se inserta antes del UPDATE para leer el estado anterior.
      await conn.query(
        `INSERT INTO Historial_Estado (id_reporte, id_admin_responsable, id_estado_anterior, id_estado_nuevo, observaciones)
         SELECT id_reporte, '${adminId}', id_estado,
                (SELECT id_estado FROM Estado WHERE nombre_estado = '${status}'), ${obs}
         FROM Reporte WHERE id_reporte = ${id}`,
      );
      await conn.query(
        `UPDATE Reporte SET id_estado = (SELECT id_estado FROM Estado WHERE nombre_estado = '${status}')
         WHERE id_reporte = ${id}`,
      );
      // RF06: el denunciante se entera del cambio.
      const message =
        `Tu reporte #${id} cambió a ${status}` +
        (observations ? `: ${observations}` : '');
      await conn.query(
        `INSERT INTO Notificacion_Alerta (id_usuario, id_reporte, mensaje)
         SELECT id_usuario, id_reporte, '${message}' FROM Reporte WHERE id_reporte = ${id}`,
      );
      await refreshUrlRisk(conn, id);
    });
    return (await this.findById(id))!;
  }

  /**
   * Asigna el nivel de riesgo de un reporte (CU18). Deja constancia en
   * `Historial_Estado` (sin cambiar el estado) y recalcula el riesgo de sus
   * URLs.
   *
   * @param id - `id_reporte`.
   * @param adminId - `id_usuario` del administrador.
   * @param riskLevel - BAJO, MEDIO, ALTO o MUY_ALTO.
   * @returns El reporte después del cambio.
   */
  async setRisk(
    id: number,
    adminId: string,
    riskLevel: string,
  ): Promise<Report> {
    await this.transaction(async (conn) => {
      await conn.query(
        `UPDATE Reporte SET nivel_riesgo_asignado = '${riskLevel}' WHERE id_reporte = ${id}`,
      );
      // Log de auditoría: mismo estado antes y después, el cambio va en
      // observaciones.
      await conn.query(
        `INSERT INTO Historial_Estado (id_reporte, id_admin_responsable, id_estado_anterior, id_estado_nuevo, observaciones)
         SELECT id_reporte, '${adminId}', id_estado, id_estado, 'Nivel de riesgo: ${riskLevel}'
         FROM Reporte WHERE id_reporte = ${id}`,
      );
      await refreshUrlRisk(conn, id);
    });
    return (await this.findById(id))!;
  }

  /**
   * Registra un archivo de evidencia de un reporte.
   *
   * @param id - `id_reporte`.
   * @param filename - Nombre del archivo dentro de `uploads/`.
   * @param mimeType - Tipo del archivo, p. ej. `image/png`.
   * @returns El reporte con la evidencia agregada, o `undefined` si no existe.
   */
  async addEvidence(
    id: number,
    filename: string,
    mimeType: string,
  ): Promise<Report | undefined> {
    await this.pool.query(
      `INSERT INTO Evidencia (id_reporte, ruta_archivo, tipo_archivo)
       VALUES (${id}, '${filename}', '${mimeType}')`,
    );
    return this.findById(id);
  }

  /**
   * Carga URLs y evidencias de varios reportes con una consulta por tabla,
   * en vez de dos por reporte.
   */
  private async withRelations(reports: Report[]): Promise<Report[]> {
    if (reports.length === 0) return reports;
    const ids = reports.map((r) => r.id).join(', ');
    const [urls] = await this.pool.query<RowDataPacket[]>(
      `SELECT ru.id_reporte, s.url_texto FROM Reporte_URL ru
       JOIN SitioWeb_URL s ON s.id_url = ru.id_url
       WHERE ru.id_reporte IN (${ids}) ORDER BY ru.fecha_asociacion, s.id_url`,
    );
    const [evidence] = await this.pool.query<RowDataPacket[]>(
      `SELECT id_reporte, ruta_archivo FROM Evidencia
       WHERE id_reporte IN (${ids}) ORDER BY fecha_carga, id_evidencia`,
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
      `INSERT INTO SitioWeb_URL (url_texto) VALUES ('${url}')
       ON DUPLICATE KEY UPDATE id_url = LAST_INSERT_ID(id_url)`,
    );
    await conn.query(
      `INSERT INTO Reporte_URL (id_reporte, id_url) VALUES (${id}, ${site.insertId})`,
    );
  }
}

/**
 * Recalcula `nivel_riesgo_global` de las URLs de un reporte: el riesgo más
 * alto entre sus reportes VALIDADO o CANALIZADO; BAJO si no tiene ninguno
 * (regla "Evaluación global de riesgo").
 */
async function refreshUrlRisk(conn: PoolConnection, id: number): Promise<void> {
  // FIELD() convierte el nivel en 1..4 para poder sacar el máximo; ELT()
  // lo regresa a texto. NO_EVALUADO da 0 → NULL → BAJO.
  await conn.query(
    `UPDATE SitioWeb_URL s SET
       nivel_riesgo_global = COALESCE((
         SELECT ELT(MAX(FIELD(r.nivel_riesgo_asignado, 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO')),
                    'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO')
         FROM Reporte_URL ru
         JOIN Reporte r ON r.id_reporte = ru.id_reporte
         JOIN Estado e ON e.id_estado = r.id_estado
         WHERE ru.id_url = s.id_url AND e.nombre_estado IN ('VALIDADO', 'CANALIZADO')
       ), 'BAJO'),
       fecha_ultima_evaluacion = NOW()
     WHERE s.id_url IN (SELECT id_url FROM Reporte_URL WHERE id_reporte = ${id})`,
  );
}

/**
 * 'sv-SE' da 'YYYY-MM-DD HH:MM:SS' en hora local, el formato que MySQL acepta
 * en un DATETIME y la misma zona con la que mysql2 lo relee.
 */
function toMysqlDate(date: Date): string {
  return date.toLocaleString('sv-SE');
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
  return report;
}

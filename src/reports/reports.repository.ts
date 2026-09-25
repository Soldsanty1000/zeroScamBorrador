/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { Report } from './entities/report.entity';

const COLUMNS =
  'r.id_reporte, r.id_usuario, r.id_tipo_fraude, e.nombre_estado, ' +
  'r.descripcion_incidente, r.fecha_incidente, r.nivel_riesgo_asignado, r.fecha_creacion';

/**
 * Acceso a las tablas `Reporte`, `SitioWeb_URL`, `Reporte_URL` y `Evidencia`.
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
      `SELECT ${COLUMNS} FROM Reporte r JOIN Estado e ON e.id_estado = r.id_estado
       WHERE r.id_reporte = ${id}`,
    );
    if (!rows[0]) return undefined;
    const [urls] = await this.pool.query<RowDataPacket[]>(
      `SELECT s.url_texto FROM Reporte_URL ru JOIN SitioWeb_URL s ON s.id_url = ru.id_url
       WHERE ru.id_reporte = ${id} ORDER BY ru.fecha_asociacion`,
    );
    const [evidence] = await this.pool.query<RowDataPacket[]>(
      `SELECT ruta_archivo FROM Evidencia WHERE id_reporte = ${id} ORDER BY fecha_carga`,
    );
    const report = toEntity(rows[0]);
    report.urls = urls.map((u) => u.url_texto);
    report.evidence = evidence.map((e) => e.ruta_archivo);
    return report;
  }

  /**
   * Inserta un reporte nuevo en estado RECIBIDO, con sus URLs, y lo regresa
   * tal como quedó en la base.
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
    // 'sv-SE' da 'YYYY-MM-DD HH:MM:SS' en hora local, el formato que MySQL
    // acepta en un DATETIME y la misma zona con la que mysql2 lo relee.
    const incidentDate = report.incidentDate!.toLocaleString('sv-SE');
    // Reporte y sus URLs van en una transacción: un reporte sin URLs rompería
    // la cardinalidad 1..N de Reporte_URL.
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      // `id_reporte` es AUTO_INCREMENT: MySQL lo regresa en `insertId`.
      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO Reporte (id_usuario, id_tipo_fraude, id_estado, descripcion_incidente, fecha_incidente)
         VALUES ('${ownerId}', ${report.fraudTypeId},
                 (SELECT id_estado FROM Estado WHERE nombre_estado = 'RECIBIDO'),
                 '${report.description}', '${incidentDate}')`,
      );
      const id = result.insertId;
      // Set para no ligar dos veces la misma URL (la PK de Reporte_URL lo
      // rechazaría).
      for (const url of new Set(report.urls)) {
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
      await conn.commit();
      return (await this.findById(id))!;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
  report.status = row.nombre_estado;
  report.description = row.descripcion_incidente;
  report.incidentDate = row.fecha_incidente;
  report.riskLevel = row.nivel_riesgo_asignado;
  report.createdAt = row.fecha_creacion;
  return report;
}

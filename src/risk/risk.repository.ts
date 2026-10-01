/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { AnonymousReportDto, RiskSiteDto } from './dto/risk-response.dto';
import { Evaluation } from './scoring';
import { hostnameOf } from './target';

/** Una fila de `SitioWeb_URL` con el análisis que tiene guardado. */
export interface StoredEvaluation {
  /** `url_texto`. */
  url: string;
  /** `nivel_riesgo_global`. */
  riskLevel: string;
  /** `estado_certificado`; no viene si la URL nunca se ha analizado. */
  certificateStatus: string | undefined;
  /** `fecha_ultima_evaluacion`; no viene si la URL nunca se ha analizado. */
  evaluatedAt: Date | undefined;
  /** `detalle_evaluacion`; no viene si la URL nunca se ha evaluado. */
  evaluation: Evaluation | undefined;
}

const EVALUATION_COLUMNS =
  'url_texto, nivel_riesgo_global, estado_certificado, fecha_ultima_evaluacion, detalle_evaluacion';

/**
 * Consultas de riesgo sobre `SitioWeb_URL` y los reportes validados ligados
 * a cada URL.
 */
@Injectable()
export class RiskRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * URLs registradas que contienen el texto buscado.
   *
   * @param q - URL o dominio (coincidencia parcial).
   */
  async findSites(q: string): Promise<RiskSiteDto[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT url_texto, nivel_riesgo_global, estado_certificado, fecha_ultima_evaluacion
       FROM SitioWeb_URL WHERE url_texto LIKE '%${q}%'
       ORDER BY FIELD(nivel_riesgo_global, 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO') DESC`,
    );
    return rows.map((row) => ({
      url: row.url_texto,
      riskLevel: row.nivel_riesgo_global,
      certificateStatus: row.estado_certificado ?? undefined,
      lastEvaluatedAt: row.fecha_ultima_evaluacion
        ? (row.fecha_ultima_evaluacion as Date).toISOString()
        : undefined,
    }));
  }

  /**
   * Reportes VALIDADO o CANALIZADO ligados a URLs que contienen el texto
   * buscado, sin datos del denunciante.
   *
   * @param q - URL o dominio (coincidencia parcial).
   */
  async findValidatedReports(q: string): Promise<AnonymousReportDto[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT DISTINCT r.id_reporte, t.nombre_tipo, r.descripcion_incidente,
              r.fecha_incidente, r.nivel_riesgo_asignado
       FROM Reporte r
       JOIN Estado e ON e.id_estado = r.id_estado
       JOIN TipoFraude t ON t.id_tipo_fraude = r.id_tipo_fraude
       JOIN Reporte_URL ru ON ru.id_reporte = r.id_reporte
       JOIN SitioWeb_URL s ON s.id_url = ru.id_url
       WHERE s.url_texto LIKE '%${q}%' AND e.nombre_estado IN ('VALIDADO', 'CANALIZADO')
       ORDER BY r.fecha_incidente DESC`,
    );
    return rows.map((row) => ({
      fraudType: row.nombre_tipo,
      description: row.descripcion_incidente,
      incidentDate: (row.fecha_incidente as Date).toISOString(),
      riskLevel: row.nivel_riesgo_asignado,
    }));
  }

  /**
   * Reportes VALIDADO o CANALIZADO de un sitio: los ligados a cualquier URL
   * cuyo host sea exactamente el indicado, sin datos del denunciante.
   *
   * @param hostname - Host normalizado, p. ej. `banco.com`.
   */
  async findValidatedReportsByHost(
    hostname: string,
  ): Promise<AnonymousReportDto[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT r.id_reporte, t.nombre_tipo, r.descripcion_incidente,
              r.fecha_incidente, r.nivel_riesgo_asignado, s.url_texto
       FROM Reporte r
       JOIN Estado e ON e.id_estado = r.id_estado
       JOIN TipoFraude t ON t.id_tipo_fraude = r.id_tipo_fraude
       JOIN Reporte_URL ru ON ru.id_reporte = r.id_reporte
       JOIN SitioWeb_URL s ON s.id_url = ru.id_url
       WHERE s.url_texto LIKE '%${hostname}%' AND e.nombre_estado IN ('VALIDADO', 'CANALIZADO')
       ORDER BY r.fecha_incidente DESC`,
    );
    // El LIKE también trae `banco.com.malo.net` o `mibanco.com`: el host se
    // compara completo aquí. Un reporte con dos URLs del sitio llega dos
    // veces; el Map lo deja una sola.
    const reports = new Map<number, AnonymousReportDto>();
    for (const row of rows) {
      if (hostnameOf(row.url_texto) !== hostname) continue;
      reports.set(row.id_reporte, {
        fraudType: row.nombre_tipo,
        description: row.descripcion_incidente,
        incidentDate: (row.fecha_incidente as Date).toISOString(),
        riskLevel: row.nivel_riesgo_asignado,
      });
    }
    return [...reports.values()];
  }

  /**
   * Análisis guardado de una URL, si todavía es reciente.
   *
   * @param url - URL normalizada (`normalizeUrl`).
   * @param maxAgeHours - Horas que un análisis se considera vigente.
   * @returns El análisis, o `undefined` si la URL no se ha analizado o su
   * análisis ya es más viejo que `maxAgeHours`.
   */
  async findEvaluation(
    url: string,
    maxAgeHours: number,
  ): Promise<StoredEvaluation | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${EVALUATION_COLUMNS} FROM SitioWeb_URL
       WHERE url_texto = '${url}' AND detalle_evaluacion IS NOT NULL
         AND fecha_ultima_evaluacion >= NOW() - INTERVAL ${maxAgeHours} HOUR`,
    );
    return rows[0] && toStored(rows[0]);
  }

  /**
   * Todas las URLs registradas de un sitio, con el análisis que tengan.
   *
   * @param hostname - Host normalizado, p. ej. `banco.com`.
   */
  async findEvaluationsByHost(hostname: string): Promise<StoredEvaluation[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${EVALUATION_COLUMNS} FROM SitioWeb_URL
       WHERE url_texto LIKE '%${hostname}%'`,
    );
    // Mismo motivo que en `findValidatedReportsByHost`: el host exacto se
    // compara aquí.
    return rows
      .map(toStored)
      .filter((site) => hostnameOf(site.url) === hostname);
  }

  /**
   * Guarda el resultado de analizar una URL, creándola en `SitioWeb_URL` si
   * no existía, y marca la fecha del análisis.
   *
   * @param url - URL normalizada (`normalizeUrl`).
   * @param certificateStatus - VALIDO, INSEGURO, EXPIRADO o INACCESIBLE.
   * @param evaluation - Puntaje, nivel y verificaciones.
   */
  async saveEvaluation(
    url: string,
    certificateStatus: string,
    evaluation: Evaluation,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO SitioWeb_URL (url_texto, nivel_riesgo_global, estado_certificado, fecha_ultima_evaluacion, detalle_evaluacion)
       VALUES ('${url}', '${evaluation.riskLevel}', '${certificateStatus}', NOW(), ${jsonLiteral(evaluation)})
       ON DUPLICATE KEY UPDATE
         nivel_riesgo_global = VALUES(nivel_riesgo_global),
         estado_certificado = VALUES(estado_certificado),
         fecha_ultima_evaluacion = VALUES(fecha_ultima_evaluacion),
         detalle_evaluacion = VALUES(detalle_evaluacion)`,
    );
  }

  /**
   * Actualiza el nivel de riesgo y el detalle de una URL ya registrada, sin
   * tocar el certificado ni la fecha del análisis: se usa cuando cambian sus
   * reportes, no cuando se vuelve a analizar.
   *
   * @param url - `url_texto` tal como está guardado.
   * @param evaluation - Puntaje, nivel y verificaciones recalculados.
   */
  async saveRisk(url: string, evaluation: Evaluation): Promise<void> {
    await this.pool.query(
      `UPDATE SitioWeb_URL SET
         nivel_riesgo_global = '${evaluation.riskLevel}',
         detalle_evaluacion = ${jsonLiteral(evaluation)}
       WHERE url_texto = '${url}'`,
    );
  }
}

/**
 * Expresión SQL con un objeto como JSON, para una columna de tipo JSON.
 *
 * El JSON lleva comillas dobles y diagonales invertidas, y los textos de las
 * verificaciones pueden traer apóstrofos ("Let's Encrypt"): pegado tal cual
 * en la consulta la rompería. Va en base64, que solo usa letras, números y
 * `+/=`, y MySQL lo decodifica.
 */
function jsonLiteral(value: object): string {
  const base64 = Buffer.from(JSON.stringify(value)).toString('base64');
  // FROM_BASE64 regresa bytes sin charset; una columna JSON exige utf8mb4.
  return `CONVERT(FROM_BASE64('${base64}') USING utf8mb4)`;
}

/**
 * Convierte una fila de `SitioWeb_URL` en un {@link StoredEvaluation}.
 *
 * @param row - Fila con las columnas de `EVALUATION_COLUMNS`.
 */
function toStored(row: any): StoredEvaluation {
  const detail = row.detalle_evaluacion;
  return {
    url: row.url_texto,
    riskLevel: row.nivel_riesgo_global,
    certificateStatus: row.estado_certificado ?? undefined,
    evaluatedAt: row.fecha_ultima_evaluacion ?? undefined,
    // mysql2 ya entrega las columnas JSON como objeto; si llegara como texto
    // (otra versión del driver) se interpreta aquí.
    evaluation:
      typeof detail === 'string'
        ? (JSON.parse(detail) as Evaluation)
        : (detail ?? undefined),
  };
}

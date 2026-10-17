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
       FROM SitioWeb_URL WHERE url_texto LIKE ?
       ORDER BY FIELD(nivel_riesgo_global, 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO') DESC`,
      [likeContains(q)],
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
       WHERE s.url_texto LIKE ? AND e.nombre_estado IN ('VALIDADO', 'CANALIZADO')
       ORDER BY r.fecha_incidente DESC`,
      [likeContains(q)],
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
       WHERE s.url_texto LIKE ? AND e.nombre_estado IN ('VALIDADO', 'CANALIZADO')
       ORDER BY r.fecha_incidente DESC`,
      [likeContains(hostname)],
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
       WHERE url_texto = ? AND detalle_evaluacion IS NOT NULL
         AND fecha_ultima_evaluacion >= NOW() - INTERVAL ? HOUR`,
      [url, maxAgeHours],
    );
    return rows[0] && toStored(rows[0]);
  }

  /**
   * Nivel de riesgo que tiene hoy una URL, sin importar si su análisis es
   * reciente.
   *
   * @param url - URL normalizada (`normalizeUrl`).
   * @returns `nivel_riesgo_global`, o `undefined` si la URL no está
   * registrada.
   */
  async findRiskLevel(url: string): Promise<string | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT nivel_riesgo_global FROM SitioWeb_URL WHERE url_texto = ?',
      [url],
    );
    return rows[0]?.nivel_riesgo_global as string | undefined;
  }

  /**
   * Todas las URLs registradas de un sitio, con el análisis que tengan.
   *
   * @param hostname - Host normalizado, p. ej. `banco.com`.
   */
  async findEvaluationsByHost(hostname: string): Promise<StoredEvaluation[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${EVALUATION_COLUMNS} FROM SitioWeb_URL
       WHERE url_texto LIKE ?`,
      [likeContains(hostname)],
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
       VALUES (?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         nivel_riesgo_global = VALUES(nivel_riesgo_global),
         estado_certificado = VALUES(estado_certificado),
         fecha_ultima_evaluacion = VALUES(fecha_ultima_evaluacion),
         detalle_evaluacion = VALUES(detalle_evaluacion)`,
      [
        url,
        evaluation.riskLevel,
        certificateStatus,
        JSON.stringify(evaluation),
      ],
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
         nivel_riesgo_global = ?,
         detalle_evaluacion = ?
       WHERE url_texto = ?`,
      [evaluation.riskLevel, JSON.stringify(evaluation), url],
    );
  }

  /**
   * Anota que un usuario analizó una URL (`Consulta_URL`). Si ya la había
   * analizado solo se actualiza la fecha.
   *
   * @param userId - `id_usuario` de quien consulta.
   * @param url - `url_texto` de una URL ya registrada.
   */
  async recordLookup(userId: string, url: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO Consulta_URL (id_usuario, id_url)
       SELECT ?, id_url FROM SitioWeb_URL WHERE url_texto = ?
       ON DUPLICATE KEY UPDATE fecha_consulta = NOW()`,
      [userId, url],
    );
  }

  /**
   * Deja una alerta (`Notificacion_Alerta`) a cada usuario activo que
   * analizó o reportó una URL en los últimos días (RF08).
   *
   * @param url - `url_texto` de la URL cuyo riesgo subió.
   * @param message - Texto de la alerta.
   * @param days - Qué tan atrás cuenta una consulta o un reporte.
   * @param exceptUserId - Usuario al que no se avisa: el que provocó el
   * cambio al analizarla, porque ya tiene el resultado en pantalla.
   */
  async alertRecentUsers(
    url: string,
    message: string,
    days: number,
    exceptUserId?: string,
  ): Promise<void> {
    // Sin usuario a excluir, `d.id_usuario <> NULL` nunca es verdadero, así
    // que el IS NULL deja pasar a todos.
    const except = exceptUserId ?? null;
    // UNION (sin ALL) deja una sola fila por usuario aunque haya consultado
    // y además reportado la URL: recibe una alerta, no dos.
    await this.pool.query(
      `INSERT INTO Notificacion_Alerta (id_usuario, id_url, mensaje)
       SELECT d.id_usuario, s.id_url, ?
       FROM SitioWeb_URL s
       JOIN (
         SELECT c.id_usuario, c.id_url FROM Consulta_URL c
         WHERE c.fecha_consulta >= NOW() - INTERVAL ? DAY
         UNION
         SELECT r.id_usuario, ru.id_url FROM Reporte_URL ru
         JOIN Reporte r ON r.id_reporte = ru.id_reporte
         WHERE r.fecha_creacion >= NOW() - INTERVAL ? DAY
       ) d ON d.id_url = s.id_url
       JOIN Usuario u ON u.id_usuario = d.id_usuario
       WHERE s.url_texto = ? AND u.estado_cuenta = 'ACTIVO'
         AND (? IS NULL OR d.id_usuario <> ?)`,
      [message, days, days, url, except, except],
    );
  }
}

/**
 * Patrón LIKE de "contiene", con `%` y `_` del texto escapados para que se
 * busquen tal cual y no funcionen como comodines.
 */
function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
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

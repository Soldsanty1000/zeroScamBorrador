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
  /**
   * Segundos que han pasado desde `fecha_ultima_evaluacion`, medidos por la
   * propia base de datos (con su reloj y su zona horaria) para no depender de
   * la hora del servidor de la API; no viene si la URL nunca se ha analizado.
   */
  ageSeconds?: number;
}

const EVALUATION_COLUMNS =
  'url_texto, nivel_riesgo_global, estado_certificado, fecha_ultima_evaluacion, detalle_evaluacion, ' +
  'TIMESTAMPDIFF(SECOND, fecha_ultima_evaluacion, NOW()) AS edad_segundos';

/** Tope de un `INTERVAL` en horas o días; nadie lo pide más grande. */
const MAX_INTERVAL = 100_000;

/**
 * Consultas de riesgo sobre `SitioWeb_URL` y los reportes validados ligados
 * a cada URL. Todo valor externo va como parámetro `?`, nunca pegado al SQL.
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
      [containing(q)],
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
      [containing(q)],
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
      [containing(hostname)],
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
   * Un análisis incompleto (`evaluation.degraded`) también se regresa aquí,
   * con su `ageSeconds`: quien llama decide si todavía sirve, porque su
   * vigencia es de minutos y no de horas.
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
      [url, interval(maxAgeHours, 'maxAgeHours')],
    );
    return rows[0] && toStored(rows[0]);
  }

  /**
   * Lo que tiene guardado una URL, sin importar si su análisis es reciente:
   * su nivel de riesgo de hoy y las verificaciones del último análisis.
   *
   * @param url - URL normalizada (`normalizeUrl`).
   * @returns La fila, o `undefined` si la URL no está registrada.
   */
  async findStored(url: string): Promise<StoredEvaluation | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${EVALUATION_COLUMNS} FROM SitioWeb_URL WHERE url_texto = ?`,
      [url],
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
       WHERE url_texto LIKE ?`,
      [containing(hostname)],
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
   * @param url - URL normalizada (`normalizeUrl`): sin cadena de consulta ni
   * fragmento, que pueden traer datos de la víctima.
   * @param certificateStatus - VALIDO, INSEGURO, EXPIRADO o INACCESIBLE.
   * @param evaluation - Puntaje, nivel y verificaciones. Si es `degraded`
   * queda marcada en `detalle_evaluacion` y `RiskService` solo la reutiliza
   * unos minutos.
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
    // Los valores van en `params` en el mismo orden en que aparecen los `?`.
    const params: unknown[] = [
      message,
      interval(days, 'days'),
      interval(days, 'days'),
      url,
    ];
    // `except` es texto fijo; el id del usuario viaja como parámetro.
    let except = '';
    if (exceptUserId) {
      except = 'AND d.id_usuario <> ?';
      params.push(exceptUserId);
    }
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
       WHERE s.url_texto = ? AND u.estado_cuenta = 'ACTIVO' ${except}`,
      params,
    );
  }
}

/**
 * Pasa a texto el patrón de un `LIKE` que busca `text` en cualquier parte.
 *
 * `\`, `%` y `_` del texto cuentan como caracteres normales y no como
 * comodines: así `50%` o `mi_sitio.com` se buscan tal cual.
 */
function containing(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * Valida el número de horas o días de un `INTERVAL ? HOUR|DAY`.
 *
 * @throws {@link RangeError} si no es un entero entre 0 y {@link MAX_INTERVAL}.
 */
function interval(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_INTERVAL) {
    throw new RangeError(
      `${name} debe ser un entero entre 0 y ${MAX_INTERVAL}`,
    );
  }
  return value;
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
    ageSeconds:
      row.edad_segundos === null || row.edad_segundos === undefined
        ? undefined
        : Number(row.edad_segundos),
    // mysql2 ya entrega las columnas JSON como objeto; si llegara como texto
    // (otra versión del driver) se interpreta aquí.
    evaluation:
      typeof detail === 'string'
        ? (JSON.parse(detail) as Evaluation)
        : (detail ?? undefined),
  };
}

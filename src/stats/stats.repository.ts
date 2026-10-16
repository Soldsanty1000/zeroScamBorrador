import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { CountDto } from './dto/stats-response.dto';

const FROM =
  'Reporte r JOIN Estado e ON e.id_estado = r.id_estado ' +
  'JOIN TipoFraude t ON t.id_tipo_fraude = r.id_tipo_fraude ' +
  'JOIN Usuario u ON u.id_usuario = r.id_usuario';

// Los fragmentos de SQL que `countBy`, `countGrouped`, `count` y
// `rangeClause` reciben como texto (qué agrupar, de dónde contar, qué
// contar, qué columna de fecha) solo se aceptan si están en estas listas:
// van pegados al SQL, así que nunca pueden salir de una entrada de usuario.
// Una estadística nueva agrega aquí su expresión.

/** Expresiones por las que se agrupa (`groupBy`). */
const GROUP_BY = [
  'e.nombre_estado',
  't.nombre_tipo',
  'r.nivel_riesgo_asignado',
  'u.pais',
  "DATE_FORMAT(r.fecha_creacion, '%Y-%m')",
  'r.nombre_rol',
  'u.estado_cuenta',
  "DATE_FORMAT(u.fecha_registro, '%Y-%m')",
  'nivel_riesgo_global',
  "DATE_FORMAT(fecha_consulta, '%Y-%m')",
];

/** Tablas o JOINs de los que se cuenta (`from`). */
const SOURCES = [
  'Usuario u JOIN Rol r ON r.id_rol = u.id_rol',
  'SitioWeb_URL',
  'Consulta_URL',
  'Notificacion_Alerta',
];

/** Qué se cuenta (`expression`). */
const COUNTS = ['COUNT(*)', 'COUNT(DISTINCT id_usuario)'];

/** Columnas de fecha a las que se aplica un periodo. */
const DATE_COLUMNS = [
  'u.fecha_registro',
  'fecha_ultima_evaluacion',
  'fecha_consulta',
  'fecha_envio',
];

/** Fecha como la espera MySQL (`toLocaleString('sv-SE')`). */
const SQL_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Fecha marcada dentro de un fragmento de `rangeClause`: `{AAAA-MM-DD HH:MM:SS}`. */
const DATE_MARK = /\{(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\}/g;

/**
 * Lo que puede quedar de un `where` cuando se cambian las marcas de fecha
 * por `?`: columnas, comparaciones y `?`. Sin comillas, `;`, paréntesis ni
 * comentarios.
 */
const SAFE_WHERE = /^[\w\s.=<>?]+$/;

/** Un trozo de SQL con sus `?` y los valores que les corresponden. */
interface Condition {
  sql: string;
  params: unknown[];
}

/** Filtros de las estadísticas; los ausentes no filtran. */
export interface StatsFilters {
  statuses?: string[];
  from?: Date;
  to?: Date;
  country?: string;
  riskLevel?: string;
}

/** Periodo de las métricas de la plataforma; los ausentes no filtran. */
export interface DateRange {
  from?: Date;
  to?: Date;
}

/**
 * Conteos agregados para las estadísticas: sobre `Reporte` y, para las
 * métricas de la plataforma, sobre usuarios, URLs, consultas y
 * notificaciones.
 */
@Injectable()
export class StatsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Cuenta reportes agrupados por una expresión SQL.
   *
   * @param groupBy - Expresión a agrupar, p. ej. `t.nombre_tipo`; debe ser
   * una de las permitidas (`GROUP_BY`).
   * @param filters - Filtros de {@link StatsFilters}; sus valores van como
   * parámetros.
   * @returns Un `{ name, count }` por grupo, de mayor a menor.
   */
  async countBy(groupBy: string, filters: StatsFilters): Promise<CountDto[]> {
    const expression = allowed(GROUP_BY, groupBy, 'groupBy');
    const where = whereClause(filters);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${expression} AS name, COUNT(*) AS count FROM ${FROM}
       WHERE ${where.sql} GROUP BY name ORDER BY count DESC, name`,
      where.params,
    );
    // COUNT(*) llega como número; `name` puede ser número (p. ej. meses).
    return rows.map((row) => ({
      name: String(row.name),
      count: Number(row.count),
    }));
  }

  /**
   * Cuenta filas de cualquier tabla agrupadas por una expresión SQL.
   *
   * @param from - Tabla o JOIN, p. ej. `Usuario u JOIN Rol r ON ...`; debe
   * ser uno de los permitidos (`SOURCES`).
   * @param groupBy - Expresión a agrupar, p. ej. `r.nombre_rol`; debe ser una
   * de las permitidas (`GROUP_BY`).
   * @param dateColumn - Columna de fecha a la que se aplica el periodo
   * (`DATE_COLUMNS`).
   * @param range - Periodo; sin fechas cuenta todo.
   * @returns Un `{ name, count }` por grupo, de mayor a menor.
   */
  async countGrouped(
    from: string,
    groupBy: string,
    dateColumn: string,
    range: DateRange,
  ): Promise<CountDto[]> {
    const source = allowed(SOURCES, from, 'from');
    const expression = allowed(GROUP_BY, groupBy, 'groupBy');
    const where = bindDates(rangeClause(dateColumn, range));
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${expression} AS name, COUNT(*) AS count FROM ${source}
       WHERE ${where.sql} GROUP BY name ORDER BY count DESC, name`,
      where.params,
    );
    return rows.map((row) => ({
      name: String(row.name),
      count: Number(row.count),
    }));
  }

  /**
   * Cuenta con una expresión SQL sobre una tabla.
   *
   * @param from - Tabla (`SOURCES`).
   * @param expression - Qué contar, p. ej. `COUNT(*)` o
   * `COUNT(DISTINCT id_usuario)` (`COUNTS`).
   * @param where - Condición; `1 = 1` para contar todo. Solo columnas,
   * comparaciones y las fechas que arma {@link rangeClause}.
   */
  async count(
    from: string,
    expression: string,
    where: string,
  ): Promise<number> {
    const source = allowed(SOURCES, from, 'from');
    const counted = allowed(COUNTS, expression, 'expression');
    const condition = bindDates(where);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${counted} AS count FROM ${source} WHERE ${condition.sql}`,
      condition.params,
    );
    return Number(rows[0].count);
  }
}

/**
 * Condición SQL que limita una columna de fecha a un periodo.
 *
 * Cada fecha queda marcada como `{AAAA-MM-DD HH:MM:SS}` y no pegada como
 * texto: {@link StatsRepository.count} y {@link StatsRepository.countGrouped}
 * cambian la marca por un `?` y mandan la fecha como parámetro. Se puede
 * seguir uniendo con otras condiciones (`+ ' AND ...'`) antes de pasarla.
 *
 * @param column - Columna de fecha (`DATE_COLUMNS`).
 * @returns `1 = 1` si el periodo no trae fechas.
 * @throws {@link RangeError} si una fecha del periodo no es válida.
 */
export function rangeClause(column: string, range: DateRange): string {
  const dateColumn = allowed(DATE_COLUMNS, column, 'column');
  const where = ['1 = 1'];
  if (range.from) {
    where.push(`${dateColumn} >= {${sqlDate(range.from)}}`);
  }
  if (range.to) {
    where.push(`${dateColumn} <= {${sqlDate(range.to)}}`);
  }
  return where.join(' AND ');
}

/** Arma el WHERE con los filtros presentes; sus valores van en `params`. */
function whereClause(filters: StatsFilters): Condition {
  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (filters.statuses) {
    if (filters.statuses.length === 0) {
      // Sin estados permitidos no se cuenta nada; `IN ()` no es SQL válido.
      where.push('1 = 0');
    } else {
      where.push('e.nombre_estado IN (?)');
      params.push(filters.statuses);
    }
  }
  if (filters.from) {
    where.push('r.fecha_creacion >= ?');
    params.push(sqlDate(filters.from));
  }
  if (filters.to) {
    where.push('r.fecha_creacion <= ?');
    params.push(sqlDate(filters.to));
  }
  if (filters.country) {
    where.push('u.pais = ?');
    params.push(filters.country);
  }
  if (filters.riskLevel) {
    where.push('r.nivel_riesgo_asignado = ?');
    params.push(filters.riskLevel);
  }
  return { sql: where.join(' AND '), params };
}

/**
 * Cambia cada fecha marcada por `rangeClause` por un `?` y regresa las
 * fechas como parámetros.
 *
 * @throws {@link Error} si después de eso queda algo que no sean columnas,
 * comparaciones y `?`.
 */
function bindDates(where: string): Condition {
  const params: string[] = [];
  const sql = where.replace(DATE_MARK, (_mark, date: string) => {
    params.push(date);
    return '?';
  });
  if (!SAFE_WHERE.test(sql)) {
    throw new Error('La condición de las estadísticas no es válida');
  }
  return { sql, params };
}

/** Fecha en el formato de MySQL (hora local), p. ej. `2026-10-14 12:30:45`. */
function sqlDate(date: Date): string {
  const text = date.toLocaleString('sv-SE');
  if (!SQL_DATE.test(text)) {
    throw new RangeError('La fecha del filtro no es válida');
  }
  return text;
}

/**
 * Regresa `value` solo si está en la lista de fragmentos SQL permitidos.
 *
 * @throws {@link Error} si no está.
 */
function allowed(list: string[], value: string, name: string): string {
  const found = list.find((item) => item === value);
  if (found === undefined) {
    throw new Error(`${name} no está permitido en las estadísticas`);
  }
  return found;
}

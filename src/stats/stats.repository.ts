import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { CountDto } from './dto/stats-response.dto';

const FROM =
  'Reporte r JOIN Estado e ON e.id_estado = r.id_estado ' +
  'JOIN TipoFraude t ON t.id_tipo_fraude = r.id_tipo_fraude ' +
  'JOIN Usuario u ON u.id_usuario = r.id_usuario';

/** Filtros de las estadísticas; los ausentes no filtran. */
export interface StatsFilters {
  statuses?: string[];
  from?: Date;
  to?: Date;
  country?: string;
  riskLevel?: string;
}

/**
 * Condición SQL con sus valores aparte: `sql` lleva `?` y `params` los
 * valores en el mismo orden, para que ningún dato entre pegado al SQL.
 */
export interface Condition {
  sql: string;
  params: unknown[];
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
   * @param groupBy - Expresión a agrupar, p. ej. `t.nombre_tipo`.
   * @param filters - Filtros de {@link StatsFilters}.
   * @returns Un `{ name, count }` por grupo, de mayor a menor.
   */
  async countBy(groupBy: string, filters: StatsFilters): Promise<CountDto[]> {
    // `groupBy` es una expresión fija del service, no un dato del usuario.
    const where = whereClause(filters);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${groupBy} AS name, COUNT(*) AS count FROM ${FROM}
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
   * @param from - Tabla o JOIN, p. ej. `Usuario u JOIN Rol r ON ...`.
   * @param groupBy - Expresión a agrupar, p. ej. `r.nombre_rol`.
   * @param dateColumn - Columna de fecha a la que se aplica el periodo.
   * @param range - Periodo; sin fechas cuenta todo.
   * @returns Un `{ name, count }` por grupo, de mayor a menor.
   */
  async countGrouped(
    from: string,
    groupBy: string,
    dateColumn: string,
    range: DateRange,
  ): Promise<CountDto[]> {
    const where = rangeClause(dateColumn, range);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${groupBy} AS name, COUNT(*) AS count FROM ${from}
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
   * @param from - Tabla.
   * @param expression - Qué contar, p. ej. `COUNT(*)` o
   * `COUNT(DISTINCT id_usuario)`.
   * @param where - Condición con sus valores; ver {@link Condition}.
   */
  async count(
    from: string,
    expression: string,
    where: Condition,
  ): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${expression} AS count FROM ${from} WHERE ${where.sql}`,
      where.params,
    );
    return Number(rows[0].count);
  }
}

/**
 * Condición SQL que limita una columna de fecha a un periodo.
 *
 * @param column - Columna fija del código, nunca un dato del usuario.
 * @returns `1 = 1` si el periodo no trae fechas.
 */
export function rangeClause(column: string, range: DateRange): Condition {
  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (range.from) {
    where.push(`${column} >= ?`);
    params.push(range.from.toLocaleString('sv-SE'));
  }
  if (range.to) {
    where.push(`${column} <= ?`);
    params.push(range.to.toLocaleString('sv-SE'));
  }
  return { sql: where.join(' AND '), params };
}

/** Agrega una condición fija (sin valores) a otra. */
export function and(condition: Condition, sql: string): Condition {
  return { sql: `${condition.sql} AND ${sql}`, params: condition.params };
}

/** Arma el WHERE con los filtros presentes. */
function whereClause(filters: StatsFilters): Condition {
  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (filters.statuses) {
    // mysql2 expande el arreglo en `IN (?)` a una lista de valores.
    where.push('e.nombre_estado IN (?)');
    params.push(filters.statuses);
  }
  if (filters.from) {
    where.push('r.fecha_creacion >= ?');
    params.push(filters.from.toLocaleString('sv-SE'));
  }
  if (filters.to) {
    where.push('r.fecha_creacion <= ?');
    params.push(filters.to.toLocaleString('sv-SE'));
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

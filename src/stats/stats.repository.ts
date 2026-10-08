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
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${groupBy} AS name, COUNT(*) AS count FROM ${FROM}
       WHERE ${whereClause(filters)} GROUP BY name ORDER BY count DESC, name`,
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
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${groupBy} AS name, COUNT(*) AS count FROM ${from}
       WHERE ${rangeClause(dateColumn, range)} GROUP BY name ORDER BY count DESC, name`,
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
   * @param where - Condición; `1 = 1` para contar todo.
   */
  async count(
    from: string,
    expression: string,
    where: string,
  ): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${expression} AS count FROM ${from} WHERE ${where}`,
    );
    return Number(rows[0].count);
  }
}

/**
 * Condición SQL que limita una columna de fecha a un periodo.
 *
 * @returns `1 = 1` si el periodo no trae fechas.
 */
export function rangeClause(column: string, range: DateRange): string {
  const where = ['1 = 1'];
  if (range.from) {
    where.push(`${column} >= '${range.from.toLocaleString('sv-SE')}'`);
  }
  if (range.to) {
    where.push(`${column} <= '${range.to.toLocaleString('sv-SE')}'`);
  }
  return where.join(' AND ');
}

/** Arma el WHERE con los filtros presentes. */
function whereClause(filters: StatsFilters): string {
  const where = ['1 = 1'];
  if (filters.statuses) {
    where.push(
      `e.nombre_estado IN (${filters.statuses.map((s) => `'${s}'`).join(', ')})`,
    );
  }
  if (filters.from) {
    where.push(`r.fecha_creacion >= '${filters.from.toLocaleString('sv-SE')}'`);
  }
  if (filters.to) {
    where.push(`r.fecha_creacion <= '${filters.to.toLocaleString('sv-SE')}'`);
  }
  if (filters.country) where.push(`u.pais = '${filters.country}'`);
  if (filters.riskLevel) {
    where.push(`r.nivel_riesgo_asignado = '${filters.riskLevel}'`);
  }
  return where.join(' AND ');
}

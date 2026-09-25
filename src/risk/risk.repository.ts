/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { AnonymousReportDto, RiskSiteDto } from './dto/risk-response.dto';

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
}

import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt';
import { POLICE_VISIBLE_STATUSES, ROLES } from '../common/constants';
import { StatsQueryDto } from './dto/stats-query.dto';
import { StatsResponseDto } from './dto/stats-response.dto';
import { StatsFilters, StatsRepository } from './stats.repository';

/**
 * Estadísticas de reportes para detectar patrones (CU12, CU21).
 */
@Injectable()
export class StatsService {
  constructor(private readonly repository: StatsRepository) {}

  /**
   * Conteos por estado, tipo de fraude, riesgo, país y mes.
   *
   * @param user - Payload del access token. La Policía solo cuenta reportes
   * VALIDADO o CANALIZADO, igual que en `GET /reports`.
   * @param query - Filtros opcionales.
   */
  async summary(
    user: JwtPayload,
    query: StatsQueryDto,
  ): Promise<StatsResponseDto> {
    const filters: StatsFilters = {
      statuses:
        user.role === ROLES.POLICE ? POLICE_VISIBLE_STATUSES : undefined,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      country: query.country,
      riskLevel: query.riskLevel,
    };
    const [byStatus, byFraudType, byRiskLevel, byCountry, byMonth] =
      await Promise.all([
        this.repository.countBy('e.nombre_estado', filters),
        this.repository.countBy('t.nombre_tipo', filters),
        this.repository.countBy('r.nivel_riesgo_asignado', filters),
        this.repository.countBy('u.pais', filters),
        this.repository.countBy(
          "DATE_FORMAT(r.fecha_creacion, '%Y-%m')",
          filters,
        ),
      ]);
    const count = (name: string) =>
      byStatus.find((s) => s.name === name)?.count ?? 0;
    // Aceptados: VALIDADO y CANALIZADO (canalizar implica haberlo validado).
    const accepted = count('VALIDADO') + count('CANALIZADO');
    const resolved = accepted + count('RECHAZADO');
    return {
      total: byStatus.reduce((sum, s) => sum + s.count, 0),
      byStatus,
      byFraudType,
      byRiskLevel,
      byCountry,
      byMonth: byMonth.sort((a, b) => a.name.localeCompare(b.name)),
      approvalRate: resolved > 0 ? accepted / resolved : null,
    };
  }
}

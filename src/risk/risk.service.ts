import { Injectable } from '@nestjs/common';
import { RISK_LEVELS } from '../common/constants';
import { RiskResponseDto } from './dto/risk-response.dto';
import { RiskRepository } from './risk.repository';

/**
 * Verificación de URLs contra la base de reportes validados (CU08, CU13,
 * RF07, RF09).
 */
@Injectable()
export class RiskService {
  constructor(private readonly repository: RiskRepository) {}

  /**
   * Nivel de riesgo, amenazas y reportes anónimos relacionados a una URL o
   * dominio.
   *
   * @param q - URL o dominio a verificar.
   * @returns `riskLevel: SIN_REGISTROS` si la URL nunca se ha reportado.
   */
  async check(q: string): Promise<RiskResponseDto> {
    const [sites, reports] = await Promise.all([
      this.repository.findSites(q),
      this.repository.findValidatedReports(q),
    ]);
    // El riesgo de la consulta es el más alto de las URLs que coinciden.
    const worst = Math.max(
      -1,
      ...sites.map((s) =>
        RISK_LEVELS.indexOf(s.riskLevel as (typeof RISK_LEVELS)[number]),
      ),
    );
    const counts = new Map<string, number>();
    for (const r of reports) {
      counts.set(r.fraudType, (counts.get(r.fraudType) ?? 0) + 1);
    }
    return {
      query: q,
      riskLevel: worst >= 0 ? RISK_LEVELS[worst] : 'SIN_REGISTROS',
      validatedReports: reports.length,
      fraudTypes: [...counts].map(([fraudType, count]) => ({
        fraudType,
        count,
      })),
      sites,
      reports,
    };
  }
}

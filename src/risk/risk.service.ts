import { Injectable } from '@nestjs/common';
import { RISK_LEVELS } from '../common/constants';
import { AnalyzeResponseDto, RiskCheckDto } from './dto/analyze-response.dto';
import { RiskResponseDto } from './dto/risk-response.dto';
import { RiskRepository } from './risk.repository';
import { resolveTarget } from './target';

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

  /**
   * Analiza una URL (RF07): la normaliza, corre las verificaciones y regresa
   * el nivel de riesgo.
   *
   * @param url - URL a analizar, ya validada por `AnalyzeUrlDto`.
   * @returns El resultado del análisis. Si el dominio no resuelve,
   * `certificateStatus` es INACCESIBLE.
   * @throws {@link BadRequestException} si la URL usa un puerto distinto de
   * 80/443 o apunta a una dirección interna.
   */
  async analyze(url: string): Promise<AnalyzeResponseDto> {
    const target = await resolveTarget(url);
    // Las verificaciones (certificado, antigüedad del dominio, listas negras,
    // heurísticas y reportes) todavía no existen: por ahora no hay señales.
    const checks: RiskCheckDto[] = [];
    return {
      url: target.url,
      hostname: target.hostname,
      riskLevel: RISK_LEVELS[0],
      score: 0,
      checks,
      certificateStatus: target.address ? undefined : 'INACCESIBLE',
      evaluatedAt: new Date().toISOString(),
    };
  }
}

import { Injectable } from '@nestjs/common';
import { RISK_LEVELS } from '../common/constants';
import { checkCertificate } from './checks/certificate.check';
import { CheckResult } from './checks/check-result';
import { checkCommunity } from './checks/community.check';
import { checkDomainAge } from './checks/domain-age.check';
import { checkHeuristics } from './checks/heuristics.check';
import { AnalyzeResponseDto } from './dto/analyze-response.dto';
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
    // Las verificaciones no dependen entre sí: van en paralelo para que la
    // respuesta tarde lo que la más lenta, no la suma (RNF01). Ninguna lanza
    // error si el sitio o un servicio externo no contesta. Falta: listas
    // negras.
    const [certificate, domainAge, reports] = await Promise.all([
      checkCertificate(target),
      checkDomainAge(target),
      // Por host y no por URL completa: cuentan los reportes de cualquier
      // página del mismo sitio.
      this.repository.findValidatedReports(target.hostname),
    ]);
    const results: CheckResult[] = [
      checkHeuristics(target),
      certificate,
      domainAge,
      checkCommunity(reports),
    ];
    const score = Math.min(
      100,
      results.reduce((sum, r) => sum + r.points, 0),
    );
    return {
      url: target.url,
      hostname: target.hostname,
      riskLevel: levelFor(score),
      score,
      checks: results.map(({ name, passed, detail }) => ({
        name,
        passed,
        detail,
      })),
      certificateStatus: certificate.status,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Convierte los puntos de riesgo en un nivel: cada 25 puntos sube uno.
 *
 * @param score - Puntos de 0 a 100.
 * @returns BAJO (0–24), MEDIO (25–49), ALTO (50–74) o MUY_ALTO (75–100).
 */
function levelFor(score: number): string {
  return RISK_LEVELS[Math.min(Math.floor(score / 25), RISK_LEVELS.length - 1)];
}

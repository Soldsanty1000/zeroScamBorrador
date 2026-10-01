import { Injectable } from '@nestjs/common';
import { RISK_LEVELS } from '../common/constants';
import { checkCertificate } from './checks/certificate.check';
import { CheckResult } from './checks/check-result';
import { checkCommunity } from './checks/community.check';
import { checkDomainAge } from './checks/domain-age.check';
import { checkHeuristics } from './checks/heuristics.check';
import { AnalyzeResponseDto, RiskCheckDto } from './dto/analyze-response.dto';
import { RiskResponseDto } from './dto/risk-response.dto';
import { RiskRepository } from './risk.repository';
import { evaluate } from './scoring';
import { hostnameOf, normalizeUrl, resolveTarget } from './target';

/** Horas que un análisis guardado se regresa sin repetirlo. */
const CACHE_HOURS = 24;

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
   * Analiza una URL (RF07): la normaliza, corre las verificaciones, guarda
   * el resultado en `SitioWeb_URL` y regresa el nivel de riesgo.
   *
   * Si la misma URL se analizó hace menos de {@link CACHE_HOURS} horas
   * regresa lo guardado (`cached: true`) sin conectarse a nada.
   *
   * @param url - URL a analizar, ya validada por `AnalyzeUrlDto`.
   * @returns El resultado del análisis. Si el dominio no resuelve,
   * `certificateStatus` es INACCESIBLE.
   * @throws {@link BadRequestException} si la URL usa un puerto distinto de
   * 80/443 o apunta a una dirección interna.
   */
  async analyze(url: string): Promise<AnalyzeResponseDto> {
    // La llave del caché es la URL completa ya normalizada. Se busca antes
    // de resolver el DNS, que es lo primero que tarda.
    const normalized = normalizeUrl(url);
    const stored = await this.repository.findEvaluation(
      normalized.url,
      CACHE_HOURS,
    );
    if (stored?.evaluation) {
      return {
        url: normalized.url,
        hostname: normalized.hostname,
        // El nivel se lee de la columna y no del detalle: es el que ven las
        // demás consultas (`GET /risk`).
        riskLevel: stored.riskLevel,
        score: stored.evaluation.score,
        checks: toCheckDtos(stored.evaluation.checks),
        certificateStatus: stored.certificateStatus,
        evaluatedAt: stored.evaluatedAt!.toISOString(),
        cached: true,
      };
    }

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
      this.repository.findValidatedReportsByHost(target.hostname),
    ]);
    const evaluation = evaluate([
      checkHeuristics(target),
      certificate,
      domainAge,
      checkCommunity(reports),
    ]);
    await this.repository.saveEvaluation(
      target.url,
      certificate.status,
      evaluation,
    );
    return {
      url: target.url,
      hostname: target.hostname,
      riskLevel: evaluation.riskLevel,
      score: evaluation.score,
      checks: toCheckDtos(evaluation.checks),
      certificateStatus: certificate.status,
      evaluatedAt: new Date().toISOString(),
      cached: false,
    };
  }

  /**
   * Recalcula el nivel de riesgo de los sitios de unas URLs cuando cambian
   * sus reportes: la administración validó, rechazó, canalizó o clasificó
   * uno (regla "Evaluación global de riesgo").
   *
   * No vuelve a conectarse a los sitios: toma las verificaciones guardadas
   * de cada URL, cambia solo la de reportes de la comunidad y vuelve a
   * puntuar con {@link evaluate}, igual que {@link analyze}. Así un reporte
   * nuevo nunca borra lo que el análisis ya había encontrado.
   *
   * @param urls - URLs del reporte que cambió (`Report.urls`).
   */
  async refreshUrls(urls: string[]): Promise<void> {
    // Set: varias URLs del reporte pueden ser del mismo sitio.
    const hostnames = new Set(
      urls.map(hostnameOf).filter((h): h is string => Boolean(h)),
    );
    for (const hostname of hostnames) {
      const [reports, sites] = await Promise.all([
        this.repository.findValidatedReportsByHost(hostname),
        this.repository.findEvaluationsByHost(hostname),
      ]);
      const community = checkCommunity(reports);
      // Todas las URLs del sitio, no solo las del reporte: el análisis de
      // cualquiera de ellas cuenta los reportes del sitio completo.
      for (const site of sites) {
        // Una URL que nunca se analizó no tiene verificaciones guardadas:
        // su nivel sale solo de los reportes.
        const others = (site.evaluation?.checks ?? []).filter(
          (c) => c.name !== community.name,
        );
        await this.repository.saveRisk(
          site.url,
          evaluate([...others, community]),
        );
      }
    }
  }
}

/** Deja de cada verificación solo lo que se muestra al usuario. */
function toCheckDtos(checks: CheckResult[]): RiskCheckDto[] {
  return checks.map(({ name, passed, detail }) => ({ name, passed, detail }));
}

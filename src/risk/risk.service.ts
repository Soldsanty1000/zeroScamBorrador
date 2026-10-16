import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RISK_LEVELS } from '../common/constants';
import { checkBlacklist } from './checks/blacklist.check';
import { checkCertificate } from './checks/certificate.check';
import { CheckResult } from './checks/check-result';
import { checkCommunity } from './checks/community.check';
import { checkDomainAge } from './checks/domain-age.check';
import { checkHeuristics } from './checks/heuristics.check';
import { AnalyzeResponseDto, RiskCheckDto } from './dto/analyze-response.dto';
import { RiskResponseDto } from './dto/risk-response.dto';
import { RiskRepository, StoredEvaluation } from './risk.repository';
import { evaluate, keepPreviousFindings, shouldAlert } from './scoring';
import { hostnameOf, normalizeUrl, resolveTarget, redactUrl } from './target';

/** Horas que un análisis guardado se regresa sin repetirlo. */
const CACHE_HOURS = 24;

/**
 * Segundos que se regresa un análisis incompleto (`degraded`) sin repetirlo.
 * Un servicio externo que falló suele volver en minutos; guardar esa
 * respuesta como si fuera completa durante {@link CACHE_HOURS} horas dejaría
 * la URL con un "BAJO" sin respaldo todo el día (y bastaría con mandarla a
 * analizar mientras Safe Browsing tarda para que quedara así).
 */
const DEGRADED_CACHE_SECONDS = 5 * 60;

/**
 * Análisis que pueden estar en curso a la vez. Cada uno abre DNS, TLS, RDAP
 * y Safe Browsing hacia afuera: sin tope, unas cuantas cuentas bastarían
 * para llenar los sockets y la memoria del servidor.
 */
const MAX_CONCURRENT_ANALYSES = 10;

/**
 * Días que cuenta como "reciente" haber consultado o reportado una URL para
 * recibir la alerta si su riesgo sube (RF08).
 */
const ALERT_DAYS = 30;

/** Nivel de una URL que todavía no está en `SitioWeb_URL`. */
const UNKNOWN_LEVEL = 'BAJO';

/**
 * Verificación de URLs contra la base de reportes validados (CU08, CU13,
 * RF07, RF09).
 */
@Injectable()
export class RiskService {
  /** Análisis con conexiones abiertas ahora mismo. */
  private running = 0;

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
      // Sin consulta ni fragmento: aquí solo se ve host y ruta (ver redactUrl).
      sites: sites.map((site) => ({ ...site, url: redactUrl(site.url) })),
      reports,
    };
  }

  /**
   * Analiza una URL (RF07): la normaliza, corre las verificaciones, guarda
   * el resultado en `SitioWeb_URL` y regresa el nivel de riesgo.
   *
   * Si la misma URL se analizó hace menos de {@link CACHE_HOURS} horas
   * regresa lo guardado (`cached: true`) sin conectarse a nada. Si ese
   * análisis quedó incompleto (`degraded: true`) solo vale
   * {@link DEGRADED_CACHE_SECONDS} segundos: pasado ese tiempo se repite.
   *
   * La URL se analiza y se guarda sin cadena de consulta ni fragmento
   * (`normalizeUrl`): dos enlaces que solo difieren en `?token=...` son el
   * mismo análisis, y los datos de quien la recibió no salen del servidor.
   *
   * Anota la consulta del usuario y, si el análisis sube la URL a riesgo
   * alto, avisa a quienes la consultaron o reportaron (RF08).
   *
   * @param url - URL a analizar, ya validada por `AnalyzeUrlDto`.
   * @param userId - `sub` del access token de quien la analiza.
   * @returns El resultado del análisis. Si el dominio no resuelve,
   * `certificateStatus` es INACCESIBLE.
   * @throws {@link BadRequestException} si la URL usa un puerto distinto de
   * 80/443 o apunta a una dirección interna.
   * @throws {@link ServiceUnavailableException} si ya hay
   * {@link MAX_CONCURRENT_ANALYSES} análisis en curso.
   */
  async analyze(url: string, userId: string): Promise<AnalyzeResponseDto> {
    // La llave del caché es la URL ya normalizada (sin consulta ni
    // fragmento). Se busca antes de resolver el DNS, que es lo primero que
    // tarda.
    const normalized = normalizeUrl(url);
    const stored = await this.repository.findEvaluation(
      normalized.url,
      CACHE_HOURS,
    );
    if (stored?.evaluation && isReusable(stored)) {
      await this.repository.recordLookup(userId, normalized.url);
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
        degraded: stored.evaluation.degraded === true,
        cached: true,
      };
    }

    const { target, certificate, domainAge, blacklist, reports } =
      await this.withinLimit(async () => {
        const target = await resolveTarget(url);
        // Las verificaciones no dependen entre sí: van en paralelo para que
        // la respuesta tarde lo que la más lenta, no la suma (RNF01).
        // Ninguna lanza error si el sitio o un servicio externo no contesta:
        // regresan `verified: false`.
        const [certificate, domainAge, blacklist, reports] = await Promise.all([
          checkCertificate(target),
          checkDomainAge(target),
          checkBlacklist(target),
          // Por host y no por URL completa: cuentan los reportes de
          // cualquier página del mismo sitio.
          this.repository.findValidatedReportsByHost(target.hostname),
        ]);
        return { target, certificate, domainAge, blacklist, reports };
      });
    // Lo que tenía guardado se lee antes de guardar lo nuevo: sirve para
    // saber si el nivel subió y, si algún servicio falló ahora, para no perder
    // lo que el análisis anterior sí había encontrado.
    const previous = await this.repository.findStored(target.url);
    const before = previous?.riskLevel ?? UNKNOWN_LEVEL;
    const evaluation = evaluate(
      keepPreviousFindings(
        [
          checkHeuristics(target),
          certificate,
          domainAge,
          blacklist,
          checkCommunity(reports),
        ],
        previous?.evaluation?.checks,
      ),
    );
    await this.repository.saveEvaluation(
      target.url,
      certificate.status,
      evaluation,
    );
    await this.repository.recordLookup(userId, target.url);
    // A quien la está analizando no se le avisa: ya tiene el resultado.
    await this.alertIfRiskRose(
      target.url,
      before,
      evaluation.riskLevel,
      userId,
    );
    return {
      url: target.url,
      hostname: target.hostname,
      riskLevel: evaluation.riskLevel,
      score: evaluation.score,
      checks: toCheckDtos(evaluation.checks),
      certificateStatus: certificate.status,
      evaluatedAt: new Date().toISOString(),
      degraded: evaluation.degraded === true,
      cached: false,
    };
  }

  /**
   * Corre `task` si hay lugar entre los análisis simultáneos.
   *
   * @throws {@link ServiceUnavailableException} si ya hay
   * {@link MAX_CONCURRENT_ANALYSES} en curso. No se hace cola: quien llama
   * puede reintentar en unos segundos.
   */
  private async withinLimit<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_CONCURRENT_ANALYSES) {
      throw new ServiceUnavailableException(
        'Hay muchos análisis en curso. Intenta de nuevo en unos segundos',
      );
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
    }
  }

  /**
   * Recalcula el nivel de riesgo de los sitios de unas URLs cuando cambian
   * sus reportes: la administración validó, rechazó, canalizó o clasificó
   * uno (regla "Evaluación global de riesgo").
   *
   * No vuelve a conectarse a los sitios: toma las verificaciones guardadas
   * de cada URL, cambia solo la de reportes de la comunidad y vuelve a
   * puntuar con {@link evaluate}, igual que {@link analyze}. Así un reporte
   * nuevo nunca borra lo que el análisis ya había encontrado. Si una URL
   * sube a riesgo alto, avisa a quienes la consultaron o reportaron (RF08).
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
        const evaluation = evaluate([...others, community]);
        await this.repository.saveRisk(site.url, evaluation);
        await this.alertIfRiskRose(
          site.url,
          site.riskLevel,
          evaluation.riskLevel,
        );
      }
    }
  }

  /**
   * Avisa a los usuarios que consultaron o reportaron una URL hace poco si
   * su riesgo subió a ALTO o MUY_ALTO (RF08, regla "Generación de Alertas").
   *
   * @param url - `url_texto` de la URL.
   * @param before - Nivel que tenía.
   * @param after - Nivel recién calculado.
   * @param exceptUserId - Usuario al que no se avisa.
   */
  private async alertIfRiskRose(
    url: string,
    before: string,
    after: string,
    exceptUserId?: string,
  ): Promise<void> {
    if (!shouldAlert(before, after)) return;
    await this.repository.alertRecentUsers(
      url,
      `Alerta: ${url} subió a riesgo ${after.replace('_', ' ')}. ` +
        'La consultaste o reportaste recientemente: evita entrar o dar tus datos.',
      ALERT_DAYS,
      exceptUserId,
    );
  }
}

/**
 * Dice si un análisis guardado todavía se puede regresar tal cual: los
 * completos valen lo que dice la consulta (24 h); los incompletos, unos
 * minutos. Si la base no dijo qué tan viejo es, un incompleto no se reusa.
 */
function isReusable(stored: StoredEvaluation): boolean {
  if (!stored.evaluation?.degraded) return true;
  return (
    stored.ageSeconds !== undefined &&
    stored.ageSeconds <= DEGRADED_CACHE_SECONDS
  );
}

/** Deja de cada verificación solo lo que se muestra al usuario. */
function toCheckDtos(checks: CheckResult[]): RiskCheckDto[] {
  return checks.map(({ name, passed, detail, verified }) => ({
    name,
    passed,
    // Los análisis guardados antes de este campo no lo traen: cuentan como
    // verificados.
    verified: verified !== false,
    detail,
  }));
}

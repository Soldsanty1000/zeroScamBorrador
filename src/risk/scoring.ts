/**
 * Puntuación del análisis de una URL: convierte los resultados de las
 * verificaciones en un nivel de riesgo.
 *
 * Es el único lugar donde se decide `SitioWeb_URL.nivel_riesgo_global`
 * (regla "Evaluación global de riesgo"): lo usan tanto el análisis de una
 * URL como el recálculo cuando la administración valida o clasifica un
 * reporte, para que los dos lleguen siempre al mismo nivel.
 */
import { RISK_LEVELS } from '../common/constants';
import { CheckResult } from './checks/check-result';

/** Lo que se guarda en `SitioWeb_URL.detalle_evaluacion`. */
export interface Evaluation {
  /** Puntos de riesgo, de 0 a 100. */
  score: number;
  /** BAJO, MEDIO, ALTO o MUY_ALTO. */
  riskLevel: string;
  /** Las verificaciones con sus puntos, para poder recalcular sin repetirlas. */
  checks: CheckResult[];
  /**
   * `true` si alguna verificación no se pudo completar (`verified: false`):
   * el nivel sale solo de las señales que sí se obtuvieron y puede ser más
   * bajo de lo que sería con todos los datos. No viene en los análisis
   * guardados antes de que existiera este campo.
   */
  degraded?: boolean;
}

/** Cada cuántos puntos sube un nivel: 0–24 BAJO, 25–49 MEDIO, 50–74 ALTO. */
const POINTS_PER_LEVEL = 25;

/**
 * Calcula el puntaje y el nivel de riesgo de una URL.
 *
 * @param checks - Resultados de las verificaciones.
 * @returns La suma de puntos (máximo 100) y el nivel: el que corresponde a
 * los puntos o el `minLevel` más alto de las verificaciones, lo que sea
 * mayor. `degraded` avisa si alguna verificación quedó sin hacer.
 *
 * @remarks
 * Decisión sobre las verificaciones sin verificar: aportan 0 puntos, así que
 * el nivel queda como estaría sin esa señal. Ni suben el riesgo (no hay
 * evidencia) ni lo bajan (no hay evidencia de que esté limpio): una URL
 * donde Safe Browsing o RDAP no contestaron no recibe un "BAJO" por eso, y
 * `degraded: true` le dice al cliente que ese nivel es un mínimo. Para que un
 * fallo pasajero tampoco borre lo que un análisis anterior sí encontró, ver
 * {@link keepPreviousFindings}.
 */
export function evaluate(checks: CheckResult[]): Evaluation {
  const score = Math.min(
    100,
    checks.reduce((sum, c) => sum + c.points, 0),
  );
  const levels: readonly string[] = RISK_LEVELS;
  const byPoints = Math.min(
    Math.floor(score / POINTS_PER_LEVEL),
    levels.length - 1,
  );
  // Un `minLevel` que no es un nivel conocido da -1 y no cuenta.
  const floor = Math.max(
    -1,
    ...checks.map((c) => (c.minLevel ? levels.indexOf(c.minLevel) : -1)),
  );
  return {
    score,
    riskLevel: levels[Math.max(byPoints, floor)],
    checks,
    degraded: checks.some((c) => c.verified === false),
  };
}

/** Se agrega al detalle de un hallazgo que viene de un análisis anterior. */
const FROM_PREVIOUS =
  ' (resultado del análisis anterior: ahora no se pudo verificar)';

/**
 * Evita que un servicio caído "borre" lo que un análisis anterior encontró.
 *
 * Si una verificación no se pudo completar ahora (`verified: false`) pero la
 * vez anterior sí había encontrado algo (puntos mayores a 0: estar en la
 * lista negra, certificado vencido, dominio nuevo), se conserva ese hallazgo
 * en lugar del vacío, y sigue marcado como no verificado. Así una URL que
 * estaba en MUY_ALTO no baja a BAJO porque Safe Browsing tardó en contestar.
 *
 * Se conserva hasta que una verificación completa lo reemplace. Una
 * verificación que nunca ha podido hacerse (una terminación sin RDAP) no
 * tiene hallazgo previo, así que no deja nada pegado.
 *
 * @param checks - Verificaciones del análisis nuevo.
 * @param previous - Verificaciones del último análisis guardado, si hay.
 */
export function keepPreviousFindings(
  checks: CheckResult[],
  previous: CheckResult[] = [],
): CheckResult[] {
  return checks.map((check) => {
    if (check.verified !== false) return check;
    const found = previous.find((p) => p.name === check.name && p.points > 0);
    if (!found) return check;
    return {
      ...found,
      verified: false,
      detail: found.detail.endsWith(FROM_PREVIOUS)
        ? found.detail
        : found.detail + FROM_PREVIOUS,
    };
  });
}

/**
 * Nivel a partir del cual una subida de riesgo se avisa a los usuarios
 * (RF08): "si la página es clasificada como de alto riesgo".
 */
const ALERT_FROM = 'ALTO';

/**
 * Dice si el cambio de nivel de una URL amerita una alerta: subió y quedó
 * en ALTO o MUY_ALTO.
 *
 * @param before - Nivel que tenía la URL.
 * @param after - Nivel recién calculado.
 */
export function shouldAlert(before: string, after: string): boolean {
  const levels: readonly string[] = RISK_LEVELS;
  const to = levels.indexOf(after);
  return to > levels.indexOf(before) && to >= levels.indexOf(ALERT_FROM);
}

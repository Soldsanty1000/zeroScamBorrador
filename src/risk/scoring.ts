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
}

/** Cada cuántos puntos sube un nivel: 0–24 BAJO, 25–49 MEDIO, 50–74 ALTO. */
const POINTS_PER_LEVEL = 25;

/**
 * Calcula el puntaje y el nivel de riesgo de una URL.
 *
 * @param checks - Resultados de las verificaciones.
 * @returns La suma de puntos (máximo 100) y el nivel: el que corresponde a
 * los puntos o el `minLevel` más alto de las verificaciones, lo que sea
 * mayor.
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
  return { score, riskLevel: levels[Math.max(byPoints, floor)], checks };
}

/**
 * Reportes de la comunidad: lo que otros usuarios ya denunciaron del mismo
 * dominio y la administración validó (RF09).
 */
import { AnonymousReportDto } from '../dto/risk-response.dto';
import { CheckResult } from './check-result';

/** Puntos de riesgo según el nivel más alto entre los reportes. */
const POINTS_BY_LEVEL: Record<string, number> = {
  MUY_ALTO: 60,
  ALTO: 45,
  MEDIO: 30,
  BAJO: 15,
  // Validado pero sin clasificar todavía: cuenta como el nivel más bajo.
  NO_EVALUADO: 15,
};

/** Del menos al más grave, para sacar el peor. */
const ORDER = ['NO_EVALUADO', 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO'];

/** Cada reporte después del primero suma esto, hasta {@link MAX_EXTRA}. */
const EXTRA_PER_REPORT = 5;
const MAX_EXTRA = 20;

/**
 * Convierte los reportes validados de un dominio en puntos de riesgo.
 *
 * @param reports - Reportes VALIDADO o CANALIZADO del dominio, sin datos del
 * denunciante (`RiskRepository.findValidatedReports`).
 * @returns `passed: true` si no hay ninguno. Si hay, los puntos dependen del
 * nivel más alto y de cuántos son, y ese nivel queda como `minLevel`.
 */
export function checkCommunity(reports: AnonymousReportDto[]): CheckResult {
  if (reports.length === 0) {
    return {
      name: 'communityReports',
      passed: true,
      detail: 'Sin reportes validados de la comunidad',
      points: 0,
    };
  }
  const worst = reports
    .map((r) => r.riskLevel)
    .reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a));
  const extra = Math.min((reports.length - 1) * EXTRA_PER_REPORT, MAX_EXTRA);
  // Set para no repetir el tipo cuando varios reportes son del mismo.
  const fraudTypes = [...new Set(reports.map((r) => r.fraudType))].join(', ');
  const count =
    reports.length === 1
      ? '1 reporte validado'
      : reports.length + ' reportes validados';
  return {
    name: 'communityReports',
    passed: false,
    detail:
      `${count} de la comunidad (${fraudTypes})` +
      (worst === 'NO_EVALUADO' ? '' : `; riesgo más alto: ${worst}`),
    points: (POINTS_BY_LEVEL[worst] ?? POINTS_BY_LEVEL.BAJO) + extra,
    // La clasificación de la administración es un piso: la URL no puede
    // quedar por debajo del reporte más grave que tiene validado.
    minLevel: worst === 'NO_EVALUADO' ? undefined : worst,
  };
}

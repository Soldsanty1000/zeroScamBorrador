/** Lo que regresa cada verificación del análisis de una URL (RF07). */
export interface CheckResult {
  /** blacklist, certificate, domainAge, heuristics o communityReports. */
  name: string;
  /** `true` si la verificación no encontró nada sospechoso. */
  passed: boolean;
  /** Explicación para mostrar al usuario. */
  detail: string;
  /** Puntos de riesgo que aporta al total (0 a 100); 0 si no encontró nada. */
  points: number;
}

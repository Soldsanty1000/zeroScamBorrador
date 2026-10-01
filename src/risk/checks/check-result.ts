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
  /**
   * Nivel del que la URL no puede bajar, sumen lo que sumen los puntos. Lo
   * usa `communityReports`: si la administración ya clasificó un reporte
   * como ALTO, la URL es al menos ALTO.
   */
  minLevel?: string;
}

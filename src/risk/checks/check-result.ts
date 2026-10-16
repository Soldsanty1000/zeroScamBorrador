/** Lo que regresa cada verificación del análisis de una URL (RF07). */
export interface CheckResult {
  /** blacklist, certificate, domainAge, heuristics o communityReports. */
  name: string;
  /**
   * `true` si la verificación se hizo y no encontró nada sospechoso. Una
   * verificación que no se pudo hacer (`verified: false`) nunca pasa: "no
   * pude revisar" no es lo mismo que "está limpio".
   */
  passed: boolean;
  /**
   * `false` si la verificación no se pudo completar: el servicio externo no
   * contestó o rechazó la consulta, el sitio no respondió, no hay llave
   * configurada… Aporta 0 puntos, pero el análisis queda como incompleto
   * (`Evaluation.degraded`). Si no viene (análisis guardados antes de que
   * existiera este campo) cuenta como verificada.
   */
  verified?: boolean;
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

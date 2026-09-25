export class Report {
  id: number | undefined;
  /** `id_usuario` del dueño, como texto (igual que el `sub` del JWT). */
  ownerId: string | undefined;
  fraudTypeId: number | undefined;
  /** `nombre_estado`: RECIBIDO, EN_REVISION, VALIDADO, RECHAZADO, CANALIZADO. */
  status: string | undefined;
  description: string | undefined;
  incidentDate: Date | undefined;
  /** BAJO, MEDIO, ALTO, MUY_ALTO; NO_EVALUADO mientras nadie lo revisa. */
  riskLevel: string | undefined;
  /** URLs sospechosas ligadas en `Reporte_URL`. */
  urls: string[] | undefined;
  /** Nombres de archivo de `Evidencia`, dentro de uploads/. */
  evidence: string[] | undefined;
  createdAt: Date | undefined;
}

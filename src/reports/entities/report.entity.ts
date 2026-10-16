export class Report {
  id: number | undefined;
  /** `id_usuario` del dueño, como texto (igual que el `sub` del JWT). */
  ownerId: string | undefined;
  fraudTypeId: number | undefined;
  /** `TipoFraude.nombre_tipo`. */
  fraudType: string | undefined;
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
  /**
   * `es_anonimo`: el autor pidió que no se le identifique. Quien consume la
   * entidad debe respetarlo y no mostrar sus datos personales.
   */
  anonymous: boolean | undefined;
}

/** Un renglón de `Historial_Estado`. */
export class ReportHistoryEntry {
  /** NULL en el registro inicial. */
  fromStatus: string | undefined;
  toStatus: string | undefined;
  observations: string | undefined;
  changedAt: Date | undefined;
}

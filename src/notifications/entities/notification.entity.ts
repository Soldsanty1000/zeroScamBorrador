export class Notification {
  id: number | undefined;
  /** `id_usuario` del destinatario, como texto (igual que el `sub` del JWT). */
  userId: string | undefined;
  /** Reporte de origen; `undefined` si es una alerta general. */
  reportId?: number | undefined;
  /** URL de una alerta de riesgo (RF08); `undefined` en los demás avisos. */
  url?: string | undefined;
  message: string | undefined;
  read: boolean | undefined;
  sentAt: Date | undefined;
}

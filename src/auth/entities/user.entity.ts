export class User {
  /** `id_usuario` (BIGINT) como texto, que es como viaja en el `sub` del JWT. */
  id: string | undefined;
  email: string | undefined;
  passwordHash: string | undefined;
  name: string | undefined;
  lastName: string | undefined;
  country: string | undefined;
  /** `nombre_rol` del rol asignado. */
  role: string | undefined;
  /** `estado_cuenta`: ACTIVO o SUSPENDIDO. */
  accountStatus: string | undefined;
  createdAt: Date | undefined;
  /**
   * `fecha_consentimiento`: cuándo aceptó el aviso de privacidad (RNF07).
   * Las cuentas de arranque de `db/schema.sql` no pasan por el registro y
   * no la tienen.
   */
  privacyAcceptedAt: Date | undefined;
}

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
}

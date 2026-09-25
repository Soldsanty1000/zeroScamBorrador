// Valores de los catálogos que el código necesita conocer por nombre. Deben
// coincidir con los INSERT de db/schema.sql.

/** `Rol.nombre_rol`. */
export const ROLES = {
  USER: 'Usuario',
  ADMIN: 'Administrador',
  POLICE: 'Policia',
  OWNER: 'Owner',
} as const;

/** `Estado.nombre_estado`. */
export const STATUSES = [
  'RECIBIDO',
  'EN_REVISION',
  'VALIDADO',
  'RECHAZADO',
  'CANALIZADO',
] as const;

/** Estados que la Policía puede ver: los ya validados por la administración. */
export const POLICE_VISIBLE_STATUSES = ['VALIDADO', 'CANALIZADO'];

/** `Reporte.nivel_riesgo_asignado` y `SitioWeb_URL.nivel_riesgo_global`. */
export const RISK_LEVELS = ['BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO'] as const;

/** `Usuario.estado_cuenta`. */
export const ACCOUNT_STATUSES = ['ACTIVO', 'SUSPENDIDO'] as const;

import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';

// Reglas de negocio de los reportes que comparten `/reports` (panel) y
// `/community` (app de iOS). Son funciones y constantes puras: no tocan la
// base ni HTTP, así se prueban sin mocks y las dos rutas aplican lo mismo.

// ---------- Máquina de estados (API-07) ----------

/**
 * Transiciones de estado permitidas, y NINGUNA más:
 *
 *   RECIBIDO -> EN_REVISION | RECHAZADO
 *   EN_REVISION -> VALIDADO | RECHAZADO
 *   VALIDADO -> CANALIZADO
 *   RECHAZADO y CANALIZADO son finales.
 *
 * Nunca se vuelve a RECIBIDO, no se salta la revisión y nada sale de un
 * estado final: un reporte validado o canalizado es parte del expediente y no
 * puede reescribirse.
 */
export const STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  RECIBIDO: ['EN_REVISION', 'RECHAZADO'],
  EN_REVISION: ['VALIDADO', 'RECHAZADO'],
  VALIDADO: ['CANALIZADO'],
  RECHAZADO: [],
  CANALIZADO: [],
};

/** Dice si un reporte puede pasar de `from` a `to`. */
export function canTransition(from: string, to: string): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * El 409 que se responde cuando `from` -> `to` no está permitido.
 */
export function invalidTransition(from: string, to: string): ConflictException {
  const allowed = STATUS_TRANSITIONS[from] ?? [];
  if (allowed.length === 0) {
    return new ConflictException(
      'El reporte está en ' + from + ', que es un estado final',
    );
  }
  return new ConflictException(
    `No se puede pasar de ${from} a ${to}; desde ${from} solo se permite: ` +
      allowed.join(' o '),
  );
}

/** El 409 que se responde cuando el estado cambió mientras se operaba. */
export function statusChanged(
  expected: string,
  current: string,
): HttpException {
  return new ConflictException(
    `El reporte cambió de estado mientras lo revisabas (esperado ${expected}, ` +
      `ahora ${current}). Recárgalo e inténtalo de nuevo.`,
  );
}

// ---------- Borrado y edición (API-06) ----------

/** El autor solo borra su reporte mientras nadie lo ha tocado. */
export const AUTHOR_DELETABLE_STATUSES: readonly string[] = ['RECIBIDO'];

/**
 * Administrador y Owner solo borran lo que no entró al expediente: RECIBIDO
 * (basura o duplicado) o RECHAZADO. EN_REVISION, VALIDADO y CANALIZADO se
 * conservan: borrarlos destruiría la cadena de custodia.
 */
export const MODERATOR_DELETABLE_STATUSES: readonly string[] = [
  'RECIBIDO',
  'RECHAZADO',
];

/** Estados en los que `quien borra` puede eliminar un reporte. */
export function deletableStatuses(asModerator: boolean): readonly string[] {
  return asModerator ? MODERATOR_DELETABLE_STATUSES : AUTHOR_DELETABLE_STATUSES;
}

/** El 409 que se responde al borrar un reporte en un estado que no lo permite. */
export function notDeletable(
  status: string,
  allowed: readonly string[],
): ConflictException {
  return new ConflictException(
    `El reporte está en ${status} y no se puede eliminar: solo se eliminan ` +
      `reportes en ${allowed.join(' o ')}. Los reportes en revisión, ` +
      'validados o canalizados se conservan como parte del registro de ' +
      'verificación.',
  );
}

/** Estados en los que el autor puede editar desde `/community`. */
export const COMMUNITY_EDITABLE_STATUSES: readonly string[] = [
  'RECIBIDO',
  'EN_REVISION',
];

// ---------- Cuotas (API-16) ----------

/** Reportes que un usuario puede crear en 24 horas, por `/reports` y `/community` juntos. */
export const REPORTS_PER_DAY = 10;

/** Comentarios que un usuario puede publicar por minuto. */
export const COMMENTS_PER_MINUTE = 5;

/**
 * Condición SQL de la cuota diaria de reportes, para un
 * `INSERT … SELECT … FROM DUAL <condición>`. Cuenta y inserta en UNA sola
 * sentencia, así dos peticiones simultáneas del mismo usuario no pueden
 * colarse por encima del tope entre el "contar" y el "insertar". Es texto
 * fijo con dos `?`: usa {@link reportQuotaParams} para los valores.
 *
 * @remarks
 * Con el aislamiento por defecto de MySQL (REPEATABLE READ) InnoDB pone
 * bloqueos compartidos sobre las filas que cuenta; dos inserciones
 * simultáneas del mismo usuario se bloquean entre sí y MySQL aborta una
 * (`ER_LOCK_DEADLOCK`, ver {@link quotaError}). Es el resultado deseado.
 */
export const REPORT_QUOTA_WHERE =
  'WHERE (SELECT COUNT(*) FROM Reporte WHERE id_usuario = ? ' +
  'AND fecha_creacion > DATE_SUB(NOW(), INTERVAL 1 DAY)) < ?';

/** Valores de los dos `?` de {@link REPORT_QUOTA_WHERE}. */
export function reportQuotaParams(userId: string | number): unknown[] {
  return [userId, REPORTS_PER_DAY];
}

/** Mensaje del 429 de la cuota diaria de reportes. */
export const REPORT_QUOTA_MESSAGE = `Llegaste al límite de ${REPORTS_PER_DAY} reportes por día. Intenta mañana.`;

/** El 429 de la cuota diaria de reportes. */
export function reportQuotaExceeded(): HttpException {
  return tooMany(REPORT_QUOTA_MESSAGE);
}

/** Un 429 con el mensaje dado. */
export function tooMany(message: string): HttpException {
  return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
}

/**
 * Traduce el abrazo mortal que MySQL aborta cuando dos inserciones del mismo
 * usuario compiten por la cuota: la perdedora recibe un 429, igual que si
 * hubiera llegado después. Cualquier otro error pasa tal cual.
 */
export function quotaError(err: unknown, message: string): unknown {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ER_LOCK_DEADLOCK' ? tooMany(message) : err;
}

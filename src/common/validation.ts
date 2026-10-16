/**
 * Correo electrónico estricto: parte local con letras, números y `._%+-`
 * (hasta 64), dominio ASCII con al menos un punto. `@IsEmail()` por sí solo
 * admite comillas, espacios y saltos de línea dentro de una parte local entre
 * comillas, que no tienen lugar en un correo de usuario.
 */
export const EMAIL_PATTERN =
  /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export const EMAIL_MESSAGE = 'email debe ser un correo electrónico válido';

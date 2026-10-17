import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

/** `crypto.scrypt` como promesa, para no bloquear el event loop. */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

const PREFIX = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * Hash con el formato real pero que no corresponde a ningún password. El
 * login lo verifica cuando el correo no existe, para tardar lo mismo que con
 * uno que sí.
 */
export const DUMMY_HASH = `${PREFIX}:${'0'.repeat(SALT_BYTES * 2)}:${'0'.repeat(KEY_BYTES * 2)}`;

/**
 * Hashea un password con scrypt y una sal aleatoria.
 *
 * scrypt es lento a propósito y la sal hace que dos passwords iguales den
 * hashes distintos: un hash filtrado no se puede buscar en una tabla ni
 * romper por fuerza bruta en minutos, como pasaba con SHA-256 sin sal.
 *
 * @param password - Password en texto plano.
 * @returns `scrypt:<sal hex>:<hash hex>`, unos 170 caracteres; cabe en la
 * columna `contrasena_hash` (VARCHAR(255)).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES);
  return `${PREFIX}:${salt.toString('hex')}:${key.toString('hex')}`;
}

/**
 * Compara un password contra el hash guardado, en tiempo constante.
 *
 * Solo acepta hashes scrypt. Un hash de otro formato (el SHA-256 sin sal de
 * antes) nunca coincide: la cuenta tiene que pasar por
 * `db/migracion-scrypt.sql`. Aun así se calcula un scrypt contra el hash de
 * relleno, para que el tiempo de respuesta sea el mismo.
 *
 * @param password - Password en texto plano.
 * @param stored - Lo que está en `contrasena_hash`.
 */
export async function verifyPassword(
  password: string,
  stored: string | undefined,
): Promise<boolean> {
  const [prefix, saltHex, keyHex] = (stored ?? '').split(':');
  const valid = prefix === PREFIX && Boolean(saltHex) && Boolean(keyHex);
  const [, salt, key] = (valid ? stored! : DUMMY_HASH).split(':');
  const expected = Buffer.from(key, 'hex');
  const actual = await scrypt(
    password,
    Buffer.from(salt, 'hex'),
    expected.length,
  );
  return valid && timingSafeEqual(actual, expected);
}

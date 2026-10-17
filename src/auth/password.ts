import {
  createHash,
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
 * Acepta también el formato anterior (SHA-256 en hex, 64 caracteres) para
 * que las cuentas creadas antes sigan entrando; {@link needsRehash} dice
 * cuándo conviene reemplazarlo.
 *
 * @param password - Password en texto plano.
 * @param stored - Lo que está en `contrasena_hash`.
 */
export async function verifyPassword(
  password: string,
  stored: string | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const [prefix, saltHex, keyHex] = stored.split(':');
  if (prefix === PREFIX && saltHex && keyHex) {
    const expected = Buffer.from(keyHex, 'hex');
    const actual = await scrypt(
      password,
      Buffer.from(saltHex, 'hex'),
      expected.length,
    );
    return timingSafeEqual(actual, expected);
  }
  if (/^[0-9a-f]{64}$/.test(stored)) {
    const expected = Buffer.from(stored, 'hex');
    const actual = createHash('sha256').update(password).digest();
    return timingSafeEqual(actual, expected);
  }
  return false;
}

/** `true` si el hash guardado es del formato anterior y hay que regenerarlo. */
export function needsRehash(stored: string | undefined): boolean {
  return !stored?.startsWith(`${PREFIX}:`);
}

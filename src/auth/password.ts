/**
 * Contraseñas con scrypt (node:crypto) y sal aleatoria por usuario.
 *
 * Se guarda `scrypt$N$r$p$<sal base64>$<hash base64>` (cabe en
 * `Usuario.contrasena_hash VARCHAR(255)`). Los parámetros viajan en el texto:
 * se pueden endurecer después y {@link needsRehash} avisa qué hashes viejos hay
 * que actualizar. Los hashes SHA-256 sin sal que dejó la versión anterior se
 * siguen aceptando una sola vez y se reemplazan al iniciar sesión.
 */
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
/** scrypt necesita ~128·N·r bytes; se da el doble de margen. */
const MAX_MEMORY = 128 * N * R * 2;
/** Tope de largo: evita gastar CPU hasheando textos enormes. */
const MAX_PASSWORD_LENGTH = 256;

const LEGACY_SHA256 = /^[0-9a-f]{64}$/;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize('NFC'),
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** Hashea una contraseña nueva con sal aleatoria. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Compara una contraseña con lo guardado, en tiempo constante.
 * @returns `false` ante cualquier formato desconocido o texto demasiado largo.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    return false;
  }
  if (LEGACY_SHA256.test(stored)) {
    const legacy = createHash('sha256').update(password).digest('hex');
    return timingSafeEqual(Buffer.from(legacy), Buffer.from(stored));
  }
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    n < 2 ** 14 ||
    n > 2 ** 20 ||
    r < 1 ||
    r > 16 ||
    p < 1 ||
    p > 4 ||
    salt.length < 8 ||
    expected.length !== KEY_LENGTH
  ) {
    return false;
  }
  try {
    const actual = await derive(password, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** `true` si el hash es del formato viejo (SHA-256) o de parámetros más débiles. */
export function needsRehash(stored: string): boolean {
  if (LEGACY_SHA256.test(stored)) return true;
  const parts = stored.split('$');
  return (
    parts.length === 6 &&
    parts[0] === 'scrypt' &&
    (Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P)
  );
}

let dummy: Promise<string> | undefined;

/**
 * Un hash válido de una contraseña que nadie conoce. Se usa para gastar el
 * mismo tiempo cuando el correo no existe, y que el tiempo de respuesta no
 * delate qué cuentas existen.
 */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString('hex'));
  return dummy;
}

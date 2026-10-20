/**
 * JWT firmado con HMAC-SHA256, construido a mano con `node:crypto`.
 *
 * Formato: `base64url(header).base64url(payload).base64url(firma)`.
 * Sin estado: el servidor no guarda tokens; los verifica recalculando la
 * firma con la misma llave. Quien no tenga la llave no puede firmar.
 */
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';

/** Largo mínimo de la llave: con menos, adivinarla por fuerza bruta es viable. */
const MIN_SECRET_LENGTH = 32;

let secret: string | undefined;

/**
 * Llave con la que se firman los tokens, tomada de `JWT_SECRET`.
 *
 * Nunca vive en el código: quien leyera el repo podría firmar tokens de
 * cualquier usuario. Sin ella el servidor no arranca (`main.ts` la pide al
 * iniciar), en vez de firmar con una llave por defecto.
 *
 * @throws `Error` si falta `JWT_SECRET` o es demasiado corta.
 */
export function jwtSecret(): string {
  if (secret) return secret;
  if (!process.env.JWT_SECRET && existsSync('.env')) process.loadEnvFile();
  const value = process.env.JWT_SECRET;
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `Falta JWT_SECRET (mínimo ${MIN_SECRET_LENGTH} caracteres): ` +
        'genera una con `openssl rand -base64 48` y ponla en .env',
    );
  }
  secret = value;
  return secret;
}

/** Lo que viaja dentro del token. `sub` es el id del usuario. */
export interface JwtPayload {
  sub: string;
  email: string;
  /** `nombre_rol`: Usuario, Administrador, Policia u Owner (RNF04). */
  role: string;
  /** Un access token no sirve para refrescar, ni un refresh para pedir recursos. */
  type: 'access' | 'refresh';
  /** Emitido en (segundos Unix). */
  iat: number;
  /**
   * Emitido en (milisegundos Unix). `iat` es por segundo: con esto se sabe si
   * un token del mismo segundo que un cambio de contraseña salió antes o
   * después. Los tokens anteriores a este campo no lo traen.
   */
  iatMs?: number;
  /** Expira en (segundos Unix). */
  exp: number;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function b64url(json: object): string {
  return Buffer.from(JSON.stringify(json)).toString('base64url');
}

function hmac(data: string): string {
  return createHmac('sha256', jwtSecret()).update(data).digest('base64url');
}

/**
 * Firma un payload y regresa el token.
 * @param payload - Claims sin `iat` ni `exp`; se agregan aquí.
 * @param ttlSeconds - Vida del token en segundos, contada desde ahora.
 * @returns El JWT como `header.payload.firma`.
 */
export function sign(
  payload: Omit<JwtPayload, 'iat' | 'iatMs' | 'exp'>,
  ttlSeconds: number,
): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const ms = Date.now();
  const iat = Math.floor(ms / 1000);
  const body = b64url({ ...payload, iat, iatMs: ms, exp: iat + ttlSeconds });
  const signature = hmac(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

/**
 * Verifica un token y regresa su payload.
 * @param token - El JWT tal como llegó en el header, sin `Bearer `.
 * @returns El payload si la firma cuadra y no ha expirado; `null` en
 *   cualquier otro caso (mal formado, firma distinta, expirado).
 */
export function verify(token: string): JwtPayload | null {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) {
    return null;
  }
  // Comparación en tiempo constante: con `!==` el tiempo de respuesta revela
  // cuántos caracteres de la firma acertó quien la está adivinando.
  const expected = Buffer.from(hmac(`${header}.${body}`));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }
  let payload: JwtPayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, 'base64url').toString(),
    ) as JwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < now()) {
    return null;
  }
  return payload;
}

/**
 * JWT firmado con HMAC-SHA256, construido a mano con `node:crypto`.
 *
 * Formato: `base64url(header).base64url(payload).base64url(firma)`.
 * Sin estado: el servidor no guarda tokens; los verifica recalculando la
 * firma con la misma llave. Quien no tenga la llave no puede firmar.
 */
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

// Llave con la que firmamos los tokens.
const SECRET = 'agenda-secret-2026';

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
  return createHmac('sha256', SECRET).update(data).digest('base64url');
}

/**
 * Firma un payload y regresa el token.
 * @param payload - Claims sin `iat` ni `exp`; se agregan aquí.
 * @param ttlSeconds - Vida del token en segundos, contada desde ahora.
 * @returns El JWT como `header.payload.firma`.
 */
export function sign(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  ttlSeconds: number,
): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ ...payload, iat: now(), exp: now() + ttlSeconds });
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
  if (hmac(`${header}.${body}`) !== signature) {
    return null;
  }
  const payload = JSON.parse(
    Buffer.from(body, 'base64url').toString(),
  ) as JwtPayload;
  if (payload.exp < now()) {
    return null;
  }
  return payload;
}

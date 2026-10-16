/**
 * JWT firmado con HMAC-SHA256, construido con `node:crypto`.
 *
 * Formato: `base64url(header).base64url(payload).base64url(firma)`.
 * La llave sale de `JWT_SECRET` (ver config.ts). Además de firma y expiración,
 * cada token lleva el id de su sesión (`sid`): el guard lo contrasta con la
 * tabla `Sesion`, así que un token se puede revocar antes de que expire.
 */
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { jwtSecret } from '../config';

const ISSUER = 'zeroscam-api';
const HEADER = { alg: 'HS256', typ: 'JWT' } as const;

/** Lo que viaja dentro del token. `sub` es el id del usuario. */
export interface JwtPayload {
  sub: string;
  email: string;
  /** `nombre_rol`: Usuario, Administrador, Policia u Owner (RNF04). */
  role: string;
  /** Un access token no sirve para refrescar, ni un refresh para pedir recursos. */
  type: 'access' | 'refresh';
  /** Id de la sesión (`Sesion.id_sesion`), 32 caracteres hexadecimales. */
  sid: string;
  /** Emisor. */
  iss: string;
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

function hmac(data: string): Buffer {
  return createHmac('sha256', jwtSecret()).update(data).digest();
}

/**
 * Firma un payload y regresa el token.
 * @param payload - Claims sin `iat`, `exp` ni `iss`; se agregan aquí.
 * @param ttlSeconds - Vida del token en segundos, contada desde ahora.
 * @returns El JWT como `header.payload.firma`.
 */
export function sign(
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss'>,
  ttlSeconds: number,
): string {
  const header = b64url(HEADER);
  const body = b64url({
    ...payload,
    iss: ISSUER,
    iat: now(),
    exp: now() + ttlSeconds,
  });
  const signature = hmac(`${header}.${body}`).toString('base64url');
  return `${header}.${body}.${signature}`;
}

/**
 * Verifica un token y regresa su payload.
 * @param token - El JWT tal como llegó en el header, sin `Bearer `.
 * @returns El payload si la firma cuadra (comparada en tiempo constante), el
 *   encabezado es el esperado, no ha expirado y trae todos los claims; `null`
 *   en cualquier otro caso. Nunca lanza.
 */
export function verify(token: string): JwtPayload | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  if (!header || !body || !signature) return null;

  const expected = hmac(`${header}.${body}`);
  const received = Buffer.from(signature, 'base64url');
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return null;
  }

  try {
    const head = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (head?.alg !== HEADER.alg || head?.typ !== HEADER.typ) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (
      typeof payload?.sub !== 'string' ||
      typeof payload?.email !== 'string' ||
      typeof payload?.role !== 'string' ||
      (payload?.type !== 'access' && payload?.type !== 'refresh') ||
      typeof payload?.sid !== 'string' ||
      !/^[0-9a-f]{32}$/.test(payload.sid) ||
      payload?.iss !== ISSUER ||
      typeof payload?.exp !== 'number' ||
      typeof payload?.iat !== 'number'
    ) {
      return null;
    }
    if (payload.exp < now()) return null;
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

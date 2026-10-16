/**
 * Configuración del servidor, leída de variables de entorno (`.env`).
 *
 * Los secretos (llave del JWT, llave de cifrado de evidencias) NO tienen valor
 * por defecto: si faltan, el servidor no arranca. Así nadie despliega por
 * accidente con una llave conocida. Con `NODE_ENV=test` (jest) se usan llaves
 * fijas de prueba para que las pruebas no dependan de un `.env`.
 */
import { existsSync, readFileSync } from 'node:fs';

let envLoaded = false;

/** Carga `.env` una sola vez; las variables del sistema tienen prioridad. */
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  if (existsSync('.env')) process.loadEnvFile();
}

const TEST_JWT_SECRET = 'solo-para-pruebas-solo-para-pruebas-0123456789';
const TEST_EVIDENCE_KEY = Buffer.alloc(32, 7);

/** Valores de ejemplo que nunca se aceptan como llave de firma. */
const WEAK_SECRETS = new Set([
  'agenda-secret-2026',
  'secret',
  'changeme',
  'cambia_esto',
]);

function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

export function isProduction(): boolean {
  loadEnv();
  return process.env.NODE_ENV === 'production';
}

/**
 * Llave HMAC con la que se firman los JWT.
 * @throws si falta, mide menos de 32 caracteres o es un valor de ejemplo.
 */
export function jwtSecret(): string {
  loadEnv();
  const value = process.env.JWT_SECRET;
  if (!value) {
    if (isTest()) return TEST_JWT_SECRET;
    throw new Error(
      'Falta JWT_SECRET en .env. Genera una con: openssl rand -base64 48',
    );
  }
  if (value.length < 32 || WEAK_SECRETS.has(value)) {
    throw new Error(
      'JWT_SECRET debe tener al menos 32 caracteres y no ser un valor de ejemplo',
    );
  }
  return value;
}

/**
 * Llave AES-256 con la que se cifran las evidencias y avatares en disco.
 * @throws si falta o no son exactamente 32 bytes en base64.
 */
export function evidenceKey(): Buffer {
  loadEnv();
  const value = process.env.EVIDENCE_KEY;
  if (!value) {
    if (isTest()) return TEST_EVIDENCE_KEY;
    throw new Error(
      'Falta EVIDENCE_KEY en .env. Genera una con: openssl rand -base64 32',
    );
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('EVIDENCE_KEY debe ser de 32 bytes en base64 (AES-256)');
  }
  return key;
}

/** Orígenes web autorizados por CORS (el panel de administración). */
export function corsOrigins(): string[] {
  loadEnv();
  return (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Interfaz de red donde escucha. Por defecto solo esta máquina. */
export function listenHost(): string {
  loadEnv();
  return process.env.HOST || '127.0.0.1';
}

export function listenPort(): number {
  loadEnv();
  return Number(process.env.PORT) || 3000;
}

/** Certificado y llave TLS si se configuraron; sin ellos el servidor habla HTTP. */
export function tlsFiles(): { key: Buffer; cert: Buffer } | undefined {
  loadEnv();
  const keyFile = process.env.TLS_KEY_FILE;
  const certFile = process.env.TLS_CERT_FILE;
  if (!keyFile || !certFile) return undefined;
  return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
}

/**
 * Swagger: habilitado fuera de producción. En producción solo si se definen
 * `SWAGGER_USER` y `SWAGGER_PASSWORD`, y entonces exige autenticación básica.
 */
export function swaggerSettings(): {
  enabled: boolean;
  user?: string;
  password?: string;
} {
  loadEnv();
  const user = process.env.SWAGGER_USER;
  const password = process.env.SWAGGER_PASSWORD;
  if (!isProduction()) return { enabled: true, user, password };
  return { enabled: Boolean(user && password), user, password };
}

/**
 * Solo desarrollo: si no hay SMTP, escribe el código de dos pasos en la
 * consola. Apagado por defecto: los códigos son credenciales.
 */
export function dev2faLog(): boolean {
  loadEnv();
  return !isProduction() && process.env.DEV_LOG_2FA_CODES === 'true';
}

/** Falla al arrancar si falta algo crítico. */
export function validateConfig(): void {
  jwtSecret();
  evidenceKey();
}

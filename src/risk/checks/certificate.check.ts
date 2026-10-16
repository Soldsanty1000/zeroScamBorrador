/**
 * Verificación del certificado TLS de un sitio: si tiene, si es válido,
 * quién lo emitió y qué tan nuevo es.
 */
import { isIP } from 'node:net';
import { connect } from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import type { Target } from '../target';
import { CheckResult } from './check-result';
import { cleanText } from './external-data';

/**
 * Lo que se espera sin que el sitio mande nada (inactividad del socket), en
 * milisegundos.
 */
const TIMEOUT = 2000;

/**
 * Lo máximo que dura toda la conexión TLS, en milisegundos. El `timeout` del
 * socket solo cuenta inactividad: un servidor que manda un byte cada segundo
 * nunca lo dispara y dejaría el análisis (y su socket) colgados para siempre.
 */
const TOTAL_TIMEOUT = 3000;

/** Largo máximo del texto del certificado que se muestra al usuario. */
const MAX_TEXT = 64;

const DAY = 24 * 60 * 60 * 1000;

/** Un certificado más nuevo que esto es señal (débil) de sitio recién montado. */
const NEW_CERTIFICATE_DAYS = 7;

/** Puntos de riesgo de cada resultado. */
const POINTS = { noHttps: 20, invalid: 35, expired: 40, recent: 10 };

/** El resultado y además el valor para `SitioWeb_URL.estado_certificado`. */
export interface CertificateResult extends CheckResult {
  /** VALIDO, INSEGURO, EXPIRADO o INACCESIBLE. */
  status: string;
}

/**
 * Revisa el certificado TLS del sitio.
 *
 * @param target - Destino ya normalizado por `resolveTarget`.
 * @returns El estado del certificado. Un sitio que no contesta no lanza
 * error: regresa `status: INACCESIBLE` con `verified: false`, que no es lo
 * mismo que un certificado válido.
 */
export async function checkCertificate(
  target: Target,
): Promise<CertificateResult> {
  if (!target.address) {
    return result(
      'INACCESIBLE',
      0,
      'El dominio no existe o no responde',
      false,
    );
  }
  if (target.protocol === 'http') {
    return result(
      'INSEGURO',
      POINTS.noHttps,
      'El sitio no usa HTTPS: lo que escribas viaja sin cifrar',
    );
  }
  let peer: Peer;
  try {
    peer = await fetchCertificate(target);
  } catch {
    return result('INACCESIBLE', 0, 'No se pudo conectar al sitio', false);
  }
  const { certificate, error } = peer;
  const validFrom = Date.parse(certificate?.valid_from);
  const validTo = Date.parse(certificate?.valid_to);
  if (Number.isNaN(validFrom) || Number.isNaN(validTo)) {
    return result(
      'INACCESIBLE',
      0,
      'El sitio no presentó un certificado legible',
      false,
    );
  }
  // El emisor lo escribe quien montó el sitio y el texto se devuelve a otros
  // usuarios y se guarda: se limpia (sin caracteres de control ni
  // invisibles, recortado). Puede venir como arreglo si el campo se repite.
  const issuer =
    cleanText(certificate.issuer?.O ?? certificate.issuer?.CN, MAX_TEXT) ||
    'emisor desconocido';
  const age = Math.floor((Date.now() - validFrom) / DAY);
  const left = Math.floor((validTo - Date.now()) / DAY);

  if (left < 0) {
    return result(
      'EXPIRADO',
      POINTS.expired,
      `El certificado de ${issuer} venció hace ${-left} días`,
    );
  }
  if (error) {
    return result(
      'INSEGURO',
      POINTS.invalid,
      `El certificado no es de confianza (${error})`,
    );
  }
  const detail = `Certificado de ${issuer}, emitido hace ${age} días, vence en ${left} días`;
  if (age < NEW_CERTIFICATE_DAYS) {
    return result('VALIDO', POINTS.recent, detail + ': es muy reciente');
  }
  return result('VALIDO', 0, detail);
}

/**
 * @param verified - `false` si no se pudo revisar el certificado (el sitio no
 * contestó): no cuenta como válido ni como sospechoso, y el análisis queda
 * incompleto.
 */
function result(
  status: string,
  points: number,
  detail: string,
  verified = true,
): CertificateResult {
  return {
    name: 'certificate',
    passed: verified && points === 0 && status === 'VALIDO',
    verified,
    detail,
    points,
    status,
  };
}

interface Peer {
  certificate: PeerCertificate;
  /** Por qué Node no confía en el certificado; `undefined` si sí confía. */
  error: string | undefined;
}

/**
 * Abre una conexión TLS y regresa el certificado que presenta el sitio.
 *
 * El socket se destruye siempre —al leer el certificado, por error o por
 * tiempo— y el temporizador de duración total se limpia en cada salida, para
 * que un sitio lento o malicioso no deje conexiones ni temporizadores vivos.
 *
 * @throws `Error` si no se puede conectar, tarda más de {@link TIMEOUT} sin
 * mandar nada o más de {@link TOTAL_TIMEOUT} en total.
 */
function fetchCertificate(target: Target): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      // Nos conectamos a la IP que ya revisó `resolveTarget`, no al nombre:
      // así el DNS no puede mandarnos a otra dirección en este momento.
      host: target.address,
      port: target.port,
      // El nombre va aparte (SNI) para que el servidor escoja su certificado
      // y Node lo compare contra él. Una IP no puede ir como servername.
      servername: isIP(target.hostname) ? undefined : target.hostname,
      // Queremos ver el certificado aunque sea inválido, para reportarlo.
      rejectUnauthorized: false,
      timeout: TIMEOUT,
    });
    // Duración total: se destruye el socket aunque el servidor siga mandando
    // bytes. Destruirlo dispara 'error' y 'close', que rechazan la promesa.
    const deadline = setTimeout(
      () => socket.destroy(new Error('timeout')),
      TOTAL_TIMEOUT,
    );
    socket.once('secureConnect', () => {
      clearTimeout(deadline);
      const certificate = socket.getPeerCertificate();
      const error = socket.authorized
        ? undefined
        : describeAuthError(socket.authorizationError);
      // Primero se resuelve y luego se destruye: destruir dispara 'close',
      // que rechaza la promesa si todavía está pendiente.
      resolve({ certificate, error });
      // `destroy` y no `end`: `end` solo manda el cierre y deja el socket
      // abierto hasta que el servidor quiera cerrar el suyo.
      socket.destroy();
    });
    socket.on('timeout', () => socket.destroy(new Error('timeout')));
    socket.on('error', (error: unknown) => {
      clearTimeout(deadline);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    // Si el servidor corta antes del certificado solo llega 'close'. Después
    // de resolver o rechazar, rechazar otra vez no hace nada.
    socket.on('close', () => {
      clearTimeout(deadline);
      reject(new Error('conexión cerrada'));
    });
  });
}

/**
 * Motivo corto por el que Node no confía en el certificado.
 *
 * Node regresa un código ("DEPTH_ZERO_SELF_SIGNED_CERT") o, si el nombre no
 * coincide, un `Error` cuyo mensaje enumera los nombres del certificado: eso
 * lo escribe el sitio, así que se usa el código y, en todo caso, el texto
 * limpio y recortado.
 */
function describeAuthError(error: unknown): string {
  let reason: unknown = error;
  if (typeof error === 'object' && error !== null) {
    reason =
      'code' in error ? error.code : 'message' in error ? error.message : '';
  }
  return cleanText(reason, MAX_TEXT) || 'motivo desconocido';
}

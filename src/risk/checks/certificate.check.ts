/**
 * Verificación del certificado TLS de un sitio: si tiene, si es válido,
 * quién lo emitió y qué tan nuevo es.
 */
import { isIP } from 'node:net';
import { connect } from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import type { Target } from '../target';
import { CheckResult } from './check-result';

/** Lo que se espera a que el sitio conteste, en milisegundos. */
const TIMEOUT = 2000;

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
 * error: regresa `status: INACCESIBLE`.
 */
export async function checkCertificate(
  target: Target,
): Promise<CertificateResult> {
  if (!target.address) {
    return result('INACCESIBLE', 0, 'El dominio no existe o no responde');
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
    return result('INACCESIBLE', 0, 'No se pudo conectar al sitio');
  }
  const { certificate, error } = peer;
  // Un certificado puede traer el campo repetido: entonces llega un arreglo.
  const issuer = String(
    certificate.issuer?.O ?? certificate.issuer?.CN ?? 'emisor desconocido',
  );
  const age = Math.floor(
    (Date.now() - Date.parse(certificate.valid_from)) / DAY,
  );
  const left = Math.floor(
    (Date.parse(certificate.valid_to) - Date.now()) / DAY,
  );

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

function result(
  status: string,
  points: number,
  detail: string,
): CertificateResult {
  return {
    name: 'certificate',
    passed: points === 0 && status === 'VALIDO',
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
 * @throws `Error` si no se puede conectar o tarda más de {@link TIMEOUT}.
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
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      const error = socket.authorized
        ? undefined
        : String(socket.authorizationError);
      socket.end();
      resolve({ certificate, error });
    });
    socket.once('timeout', () => socket.destroy(new Error('timeout')));
    socket.once('error', reject);
  });
}

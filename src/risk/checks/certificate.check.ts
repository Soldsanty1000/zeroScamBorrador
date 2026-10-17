/**
 * Verificación del certificado TLS de un sitio: si tiene, si es válido,
 * quién lo emitió y qué tan nuevo es.
 */
import { isIP } from 'node:net';
import { connect } from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import type { Target } from '../target';
import { CheckResult } from './check-result';

/**
 * Lo que se espera a que el sitio conteste, en milisegundos. Con 2 s algunos
 * sitios legítimos lentos (o detrás de un WAF) salían como inaccesibles.
 */
const TIMEOUT = 4000;

const DAY = 24 * 60 * 60 * 1000;

/** Un certificado más nuevo que esto es señal (débil) de sitio recién montado. */
const NEW_CERTIFICATE_DAYS = 7;

/** Puntos de riesgo de cada resultado. */
const POINTS = {
  noHttps: 20,
  invalid: 35,
  expired: 40,
  recent: 10,
};

/**
 * Códigos que da tanto una cadena a la que el servidor no le mandó el
 * intermedio (error de configuración que el navegador suele completar) como
 * un certificado de una autoridad privada. Sin desactivar la validación no
 * se pueden distinguir, así que puntúa igual que cualquier certificado no
 * confiable; solo el mensaje lo aclara.
 */
const UNVERIFIED_ISSUER = [
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
];

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
  if ('error' in peer) {
    if (peer.error === 'CERT_HAS_EXPIRED') {
      return result('EXPIRADO', POINTS.expired, 'El certificado ya venció');
    }
    if (UNVERIFIED_ISSUER.includes(peer.error)) {
      return result(
        'INSEGURO',
        POINTS.invalid,
        'No se puede verificar quién emitió el certificado: puede ser una autoridad no confiable o un servidor mal configurado que no envía la cadena completa',
      );
    }
    return result(
      'INSEGURO',
      POINTS.invalid,
      `El certificado no es de confianza: ${CERT_ERRORS[peer.error] ?? peer.error}`,
    );
  }
  const { certificate } = peer;
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

/**
 * Códigos con los que Node rechaza un certificado, y cómo explicarlos. Un
 * código que no esté aquí se muestra tal cual.
 */
const CERT_ERRORS: Record<string, string> = {
  CERT_HAS_EXPIRED: 'ya venció',
  CERT_NOT_YET_VALID: 'todavía no es válido',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'es autofirmado',
  SELF_SIGNED_CERT_IN_CHAIN: 'su cadena incluye un certificado autofirmado',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'no se puede verificar quién lo emitió',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'lo emitió una autoridad desconocida',
  ERR_TLS_CERT_ALTNAME_INVALID: 'no corresponde a este dominio',
  CERT_REVOKED: 'fue revocado',
};

/** El certificado si Node confió en él, o el motivo por el que lo rechazó. */
type Peer = { certificate: PeerCertificate } | { error: string };

/**
 * Abre una conexión TLS validando el certificado como lo haría un navegador.
 *
 * No se desactiva la validación: si el certificado no es de confianza, Node
 * corta la conexión y el código de error es justo lo que se reporta.
 *
 * @throws `Error` si no se puede conectar por otra causa o tarda más de
 * {@link TIMEOUT}.
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
      timeout: TIMEOUT,
    });
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      resolve({ certificate });
    });
    socket.once('timeout', () => socket.destroy(new Error('timeout')));
    socket.once('error', (err: NodeJS.ErrnoException) => {
      // Un certificado rechazado es un resultado, no una falla de conexión.
      if (err.code && (err.code in CERT_ERRORS || /CERT|TLS/.test(err.code))) {
        resolve({ error: err.code });
      } else {
        reject(err);
      }
    });
  });
}

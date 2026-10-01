/**
 * Antigüedad del dominio: los sitios de fraude suelen usar dominios
 * registrados hace días, porque los dan de baja rápido.
 *
 * La fecha se pide por RDAP, el reemplazo de WHOIS: es HTTP con JSON, así
 * que no hay que interpretar texto. Las terminaciones que no tienen RDAP,
 * como .mx, se preguntan por WHOIS directo a su registro (un socket al
 * puerto 43), sin ejecutar el comando `whois`.
 */
import { connect, isIP } from 'node:net';
import type { Target } from '../target';
import { CheckResult } from './check-result';

/**
 * rdap.org redirige al servidor RDAP del registro de cada terminación
 * (.com → Verisign, .org → PIR…). Las que no tienen RDAP, como .mx,
 * responden 404.
 */
const RDAP_URL = 'https://rdap.org/domain/';

/** Servidor WHOIS del registro de las terminaciones sin RDAP. */
const WHOIS_SERVERS: Record<string, string> = {
  mx: 'whois.mx',
};

const WHOIS_PORT = 43;

/** Una respuesta de WHOIS son pocos KB; más que esto no se lee. */
const WHOIS_MAX_BYTES = 64 * 1024;

/** Lo que se espera a que el registro conteste, en milisegundos. */
const TIMEOUT = 2000;

const DAY = 24 * 60 * 60 * 1000;

/** Puntos de riesgo según los días que tiene el dominio. */
const VERY_NEW = { days: 30, points: 30 };
const NEW = { days: 180, points: 15 };

/**
 * Segundos niveles que funcionan como terminación en dominios de país:
 * en `banco.com.mx` el dominio registrado es `banco.com.mx`, no `com.mx`.
 */
const SECOND_LEVELS = ['com', 'org', 'net', 'edu', 'gob', 'gov', 'co'];

/**
 * Revisa hace cuánto se registró el dominio.
 *
 * @param target - Destino ya normalizado por `resolveTarget`.
 * @returns `passed: false` si el dominio tiene menos de 180 días. Si no se
 * puede saber la fecha (IP, terminación sin RDAP ni WHOIS conocido,
 * dominio sin registrar, registro caído) regresa
 * `passed: true` con 0 puntos y lo explica en `detail`.
 */
export async function checkDomainAge(target: Target): Promise<CheckResult> {
  if (isIP(target.hostname)) {
    return ageResult(undefined, 'No aplica: la URL usa una dirección IP');
  }
  const domain = registrableDomain(target.hostname);
  const whoisServer = WHOIS_SERVERS[domain.split('.').pop()!];
  const registered = whoisServer
    ? await fetchWhoisDate(domain, whoisServer)
    : await fetchRegistrationDate(domain);
  if (!registered) {
    return ageResult(
      undefined,
      `No se pudo consultar la fecha de registro de ${domain}`,
    );
  }
  return ageResult(registered, domain);
}

/**
 * Arma el resultado a partir de la fecha de registro.
 *
 * @param registered - Fecha de registro; `undefined` si no se pudo saber.
 * @param subject - El dominio, o el motivo si no hay fecha.
 * @param now - Fecha contra la que se compara; solo cambia en las pruebas.
 */
export function ageResult(
  registered: Date | undefined,
  subject: string,
  now: Date = new Date(),
): CheckResult {
  if (!registered) {
    return { name: 'domainAge', passed: true, detail: subject, points: 0 };
  }
  const days = Math.floor((now.getTime() - registered.getTime()) / DAY);
  const detail = `${subject} se registró hace ${describeAge(days)}`;
  if (days < VERY_NEW.days) {
    return {
      name: 'domainAge',
      passed: false,
      detail: detail + ': es muy nuevo',
      points: VERY_NEW.points,
    };
  }
  if (days < NEW.days) {
    return {
      name: 'domainAge',
      passed: false,
      detail: detail + ': es reciente',
      points: NEW.points,
    };
  }
  return { name: 'domainAge', passed: true, detail, points: 0 };
}

/**
 * Dominio que se registra, sin subdominios: `www.tienda.ejemplo.com` →
 * `ejemplo.com`, `login.banco.com.mx` → `banco.com.mx`.
 *
 * @remarks
 * Es una aproximación: la lista completa de terminaciones (Public Suffix
 * List) tiene miles de entradas. Cubre las de {@link SECOND_LEVELS}.
 */
export function registrableDomain(hostname: string): string {
  const labels = hostname.split('.');
  const countryCode = labels[labels.length - 1].length === 2;
  const secondLevel = SECOND_LEVELS.includes(labels[labels.length - 2]);
  return labels.slice(countryCode && secondLevel ? -3 : -2).join('.');
}

/** `45` → "45 días"; `800` → "2 años". */
function describeAge(days: number): string {
  if (days < 365) return days === 1 ? '1 día' : days + ' días';
  const years = Math.floor(days / 365);
  return years === 1 ? '1 año' : years + ' años';
}

/**
 * Pide por RDAP la fecha en que se registró un dominio.
 *
 * @returns La fecha, o `undefined` si el registro no contesta a tiempo, no
 * conoce el dominio o su terminación no tiene RDAP.
 */
async function fetchRegistrationDate(
  domain: string,
): Promise<Date | undefined> {
  try {
    const response = await fetch(RDAP_URL + encodeURIComponent(domain), {
      signal: AbortSignal.timeout(TIMEOUT),
      // Sin User-Agent rdap.org contesta 403.
      headers: {
        'user-agent': 'ZeroScam/1.0',
        accept: 'application/rdap+json',
      },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      events?: { eventAction: string; eventDate: string }[];
    };
    const event = body.events?.find((e) => e.eventAction === 'registration');
    const date = event && new Date(event.eventDate);
    return date && !Number.isNaN(date.getTime()) ? date : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pide por WHOIS la fecha en que se registró un dominio.
 *
 * @param domain - Dominio registrable, p. ej. `banco.com.mx`.
 * @param server - Servidor WHOIS del registro, de {@link WHOIS_SERVERS}.
 * @returns La fecha, o `undefined` si el registro no contesta a tiempo o no
 * conoce el dominio.
 */
async function fetchWhoisDate(
  domain: string,
  server: string,
): Promise<Date | undefined> {
  try {
    return parseWhoisDate(await whois(domain, server));
  } catch {
    return undefined;
  }
}

/**
 * Saca la fecha de registro de una respuesta de WHOIS.
 *
 * @param text - Respuesta completa del servidor.
 * @returns La fecha de la línea `Created On: 2009-05-04` (formato de NIC
 * México); `undefined` si no viene, como cuando el dominio no existe.
 */
export function parseWhoisDate(text: string): Date | undefined {
  const match = text.match(/^Created On:\s*(\d{4}-\d{2}-\d{2})/m);
  if (!match) return undefined;
  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Hace una consulta WHOIS: abre un socket, manda el dominio y lee hasta que
 * el servidor cierra.
 *
 * @throws `Error` si no se puede conectar o tarda más de {@link TIMEOUT}.
 */
function whois(domain: string, server: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const socket = connect({ host: server, port: WHOIS_PORT });
    // El `timeout` del socket solo cuenta inactividad; este cuenta la
    // consulta completa, incluido el DNS del servidor.
    const timer = setTimeout(
      () => socket.destroy(new Error('timeout')),
      TIMEOUT,
    );
    // El protocolo es una línea con lo que se busca, terminada en CRLF.
    socket.once('connect', () => socket.write(domain + '\r\n'));
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('latin1');
      if (text.length > WHOIS_MAX_BYTES) socket.destroy();
    });
    socket.once('error', reject);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(text);
    });
  });
}

/**
 * Antigüedad del dominio: los sitios de fraude suelen usar dominios
 * registrados hace días, porque los dan de baja rápido.
 *
 * La fecha se pide por RDAP, el reemplazo de WHOIS: es HTTP con JSON, así
 * que no hay que interpretar texto. Se pregunta directo al registro de cada
 * terminación (Verisign para .com, PIR para .org…), según la tabla oficial
 * de IANA; rdap.org, que redirige al registro, solo queda de respaldo
 * porque bloquea (403) cuando le llegan varias consultas a la vez. Las
 * terminaciones que no tienen RDAP, como .mx, se preguntan por WHOIS directo
 * a su registro (un socket al puerto 43), sin ejecutar el comando `whois`.
 *
 * La fecha de registro no cambia: se guarda por dominio y la siguiente
 * consulta del mismo dominio no sale a la red.
 */
import { connect, isIP } from 'node:net';
import type { Target } from '../target';
import { CheckResult } from './check-result';

/** Tabla de IANA: qué servidor RDAP atiende cada terminación. */
const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
/** Respaldo si la terminación no está en la tabla o no se pudo bajar. */
const FALLBACK_RDAP = 'https://rdap.org/';
/** La tabla casi no cambia: se vuelve a bajar una vez al día. */
const BOOTSTRAP_TTL = 24 * 60 * 60 * 1000;
/** Fechas ya consultadas; la de un dominio no cambia. */
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;
/** Consultas simultáneas por servidor RDAP, para no provocar bloqueos. */
const PER_HOST = 2;
/** Respuestas que valen un segundo intento tras una pausa corta. */
const RETRY_STATUS = [403, 429, 500, 502, 503, 504];
const RETRY_DELAY = 600;

/** Servidor WHOIS del registro de las terminaciones sin RDAP. */
const WHOIS_SERVERS: Record<string, string> = {
  mx: 'whois.mx',
};

const WHOIS_PORT = 43;

/** Una respuesta de WHOIS son pocos KB; más que esto no se lee. */
const WHOIS_MAX_BYTES = 64 * 1024;

/** Lo que se espera a que el registro conteste, en milisegundos. */
const TIMEOUT = 3000;

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
  const registered = await registrationDate(domain);
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

const cache = new Map<string, { date: Date; at: number }>();

/**
 * Fecha de registro de un dominio: de la caché si ya se consultó, si no
 * por WHOIS (terminaciones sin RDAP) o RDAP.
 */
async function registrationDate(domain: string): Promise<Date | undefined> {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.date;
  const whoisServer = WHOIS_SERVERS[domain.split('.').pop()!];
  const date = whoisServer
    ? await fetchWhoisDate(domain, whoisServer)
    : await fetchRegistrationDate(domain);
  // Solo se guarda lo que se supo: un "no contestó" se vuelve a intentar.
  if (date) {
    // Map guarda el orden de inserción: el primero es el más viejo.
    const oldest = cache.keys().next();
    if (cache.size >= CACHE_MAX && !oldest.done) cache.delete(oldest.value);
    cache.set(domain, { date, at: Date.now() });
  }
  return date;
}

let bootstrap: { services: Map<string, string>; at: number } | undefined;
/** Descarga en curso de la tabla: todas las consultas esperan la misma. */
let loading: Promise<void> | undefined;

/**
 * Servidor RDAP de una terminación según la tabla de IANA, o el respaldo.
 * Si la tabla no se puede bajar se usa el respaldo y se intenta otra vez en
 * la siguiente consulta.
 */
async function rdapBase(tld: string): Promise<string> {
  if (!bootstrap || Date.now() - bootstrap.at > BOOTSTRAP_TTL) {
    loading ??= loadBootstrap().finally(() => (loading = undefined));
    await loading;
  }
  return bootstrap?.services.get(tld) ?? FALLBACK_RDAP;
}

/** Baja la tabla de IANA; si falla, deja la anterior (o ninguna). */
async function loadBootstrap(): Promise<void> {
  try {
    const response = await fetch(BOOTSTRAP_URL, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const body = (await response.json()) as {
      services: [string[], string[]][];
    };
    const services = new Map<string, string>();
    for (const [tlds, urls] of body.services) {
      const base = urls.find((u) => u.startsWith('https://')) ?? urls[0];
      for (const t of tlds) {
        services.set(t, base.endsWith('/') ? base : base + '/');
      }
    }
    bootstrap = { services, at: Date.now() };
  } catch {
    // Sin tabla, esta ronda usa el respaldo.
  }
}

/** Consultas en curso por servidor y quién espera turno. */
const slots = new Map<string, { active: number; waiting: (() => void)[] }>();

/** Corre `work` cuando el servidor tiene menos de {@link PER_HOST} en curso. */
async function limited<T>(host: string, work: () => Promise<T>): Promise<T> {
  const slot = slots.get(host) ?? { active: 0, waiting: [] };
  slots.set(host, slot);
  if (slot.active >= PER_HOST) {
    await new Promise<void>((resolve) => slot.waiting.push(resolve));
  }
  slot.active++;
  try {
    return await work();
  } finally {
    slot.active--;
    slot.waiting.shift()?.();
  }
}

/**
 * Pide por RDAP la fecha en que se registró un dominio, directo al registro
 * de su terminación, con un reintento si el servidor pide esperar.
 *
 * @returns La fecha, o `undefined` si el registro no contesta a tiempo, no
 * conoce el dominio o su terminación no tiene RDAP.
 */
async function fetchRegistrationDate(
  domain: string,
): Promise<Date | undefined> {
  const base = await rdapBase(domain.split('.').pop()!);
  const url = `${base}domain/${encodeURIComponent(domain)}`;
  return limited(new URL(base).host, async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT),
          // Sin User-Agent algunos servidores (rdap.org) contestan 403.
          headers: {
            'user-agent': 'ZeroScam/1.0',
            accept: 'application/rdap+json',
          },
        });
        if (RETRY_STATUS.includes(response.status) && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        if (!response.ok) return undefined;
        const body = (await response.json()) as {
          events?: { eventAction: string; eventDate: string }[];
        };
        const event = body.events?.find(
          (e) => e.eventAction === 'registration',
        );
        const date = event && new Date(event.eventDate);
        return date && !Number.isNaN(date.getTime()) ? date : undefined;
      } catch {
        // Si no contestó a tiempo no se reintenta: duplicaría la espera.
        return undefined;
      }
    }
    return undefined;
  });
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
    return parseWhoisDate(await limited(server, () => whois(domain, server)));
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

/**
 * Normaliza la URL que se va a analizar y decide si el servidor se puede
 * conectar a ella.
 *
 * El análisis (RF07) hace que el servidor abra conexiones hacia un host que
 * escoge el usuario. Sin filtro, alguien podría pedir que "analicemos"
 * `http://localhost:3306` o `http://192.168.1.1` y usar la API para asomarse
 * a la red interna (SSRF). Por eso aquí se resuelve el DNS una sola vez y se
 * rechazan las direcciones que no son públicas.
 *
 * También decide qué parte de la URL sale del servidor y se guarda: solo
 * `esquema://host[:puerto]/ruta`. Ver {@link normalizeUrl}.
 */
import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Puertos a los que el análisis se puede conectar. */
const ALLOWED_PORTS = [80, 443];

/** Lo que se espera a que el DNS conteste, en milisegundos. */
const DNS_TIMEOUT = 2000;

/**
 * Rangos que no son de internet pública: loopback, redes privadas,
 * link-local, documentación, multicast, reservados y los prefijos de
 * traducción/túnel IPv6 que llevan una IPv4 adentro (NAT64, 6to4, Teredo).
 */
const PRIVATE = new BlockList();
// IPv4
PRIVATE.addSubnet('0.0.0.0', 8); // "esta red"
PRIVATE.addSubnet('10.0.0.0', 8); // privada
PRIVATE.addSubnet('100.64.0.0', 10); // CGNAT
PRIVATE.addSubnet('127.0.0.0', 8); // loopback
PRIVATE.addSubnet('169.254.0.0', 16); // link-local (metadatos de la nube)
PRIVATE.addSubnet('172.16.0.0', 12); // privada
PRIVATE.addSubnet('192.0.0.0', 24); // protocolos IETF
PRIVATE.addSubnet('192.0.2.0', 24); // documentación (TEST-NET-1)
PRIVATE.addSubnet('192.88.99.0', 24); // relevo 6to4 (obsoleto)
PRIVATE.addSubnet('192.168.0.0', 16); // privada
PRIVATE.addSubnet('198.18.0.0', 15); // pruebas de rendimiento
PRIVATE.addSubnet('198.51.100.0', 24); // documentación (TEST-NET-2)
PRIVATE.addSubnet('203.0.113.0', 24); // documentación (TEST-NET-3)
PRIVATE.addSubnet('224.0.0.0', 4); // multicast
PRIVATE.addSubnet('240.0.0.0', 4); // reservado (incluye 255.255.255.255)
// IPv6. Las IPv4 "mapeadas" (::ffff:a.b.c.d) no van aquí: `unmapIPv4` las
// convierte a IPv4 antes de revisarlas.
PRIVATE.addSubnet('::', 96, 'ipv6'); // :: , ::1 e IPv4-compatible (obsoleto)
PRIVATE.addSubnet('::ffff:0:0:0', 96, 'ipv6'); // IPv4 traducida (SIIT)
PRIVATE.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64
PRIVATE.addSubnet('64:ff9b:1::', 48, 'ipv6'); // NAT64 de uso local
PRIVATE.addSubnet('100::', 64, 'ipv6'); // descarte
PRIVATE.addSubnet('2001::', 32, 'ipv6'); // Teredo
PRIVATE.addSubnet('2001:db8::', 32, 'ipv6'); // documentación
PRIVATE.addSubnet('2002::', 16, 'ipv6'); // 6to4
PRIVATE.addSubnet('fc00::', 7, 'ipv6'); // única local (privada)
PRIVATE.addSubnet('fe80::', 10, 'ipv6'); // link-local
PRIVATE.addSubnet('fec0::', 10, 'ipv6'); // site-local (obsoleta)
PRIVATE.addSubnet('ff00::', 8, 'ipv6'); // multicast

/** A dónde se van a conectar las verificaciones del análisis. */
export interface Target {
  /**
   * La URL normalizada: host en minúsculas, **sin cadena de consulta, sin
   * fragmento y sin usuario/clave**. Es la que se guarda y la que se manda a
   * servicios externos.
   */
  url: string;
  /** Host sin puerto ni corchetes, en minúsculas (punycode si traía acentos). */
  hostname: string;
  protocol: 'http' | 'https';
  port: number;
  /**
   * `true` si la URL original traía `usuario:clave@` antes del host. Se
   * quitan de `url`, pero el `@` es una señal de phishing que revisa
   * `checkHeuristics`. Si no viene, esa verificación lo busca en `url`.
   */
  hasUserInfo?: boolean;
  /**
   * IP pública a la que resolvió el host; `undefined` si el dominio no
   * resuelve (sitio inaccesible). Las verificaciones deben conectarse a esta
   * IP y no volver a resolver el nombre: si lo hicieran, el DNS podría
   * contestar otra cosa la segunda vez (DNS rebinding).
   */
  address: string | undefined;
}

/** La URL normalizada, antes de resolver su host. */
export type NormalizedUrl = Omit<Target, 'address'>;

/**
 * Normaliza una URL sin conectarse a nada: host en minúsculas y solo
 * `esquema://host[:puerto]/ruta`. Dos formas de escribir la misma URL dan el
 * mismo resultado, que es la llave con la que se guarda su análisis.
 *
 * Se descartan la cadena de consulta (`?...`), el fragmento (`#...`) y el
 * `usuario:clave@`. Es lo que casi siempre trae datos de la víctima (tokens,
 * correos, identificadores de sesión) y ni la base ni Google Safe Browsing
 * tienen por qué recibirlos: para saber si un sitio es malicioso basta con
 * el host y la ruta.
 *
 * @remarks
 * La ruta sí se conserva: Safe Browsing marca páginas concretas y el host
 * solo no basta, y la ruta de un sitio de fraude suele ser lo que lo delata
 * (`/login`, `/verifica`). Aun así puede traer un identificador
 * (`/reset/<token>`, `;jsessionid=...`): quien reporte o analice una URL no
 * debería pegar enlaces con secretos en la ruta.
 *
 * @param raw - La URL tal como llegó, ya validada por `AnalyzeUrlDto`.
 * @throws {@link BadRequestException} si la URL no se puede leer o usa un
 * puerto distinto de 80/443.
 */
export function normalizeUrl(raw: string): NormalizedUrl {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new BadRequestException('url no es una URL válida');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('url debe ser http o https');
  }
  const protocol = parsed.protocol === 'https:' ? 'https' : 'http';
  // `port` viene vacío cuando es el puerto por defecto del protocolo.
  const port = parsed.port
    ? Number(parsed.port)
    : protocol === 'https'
      ? 443
      : 80;
  if (!ALLOWED_PORTS.includes(port)) {
    throw new BadRequestException('Solo se analizan los puertos 80 y 443');
  }
  const hasUserInfo = Boolean(parsed.username || parsed.password);
  // Ver el comentario de la función: nada de esto se guarda ni se manda fuera.
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  return {
    url: parsed.toString(),
    hostname: cleanHostname(parsed),
    protocol,
    port,
    hasUserInfo,
  };
}

/**
 * Normaliza una URL y resuelve su host.
 *
 * @param raw - La URL tal como llegó, ya validada por `AnalyzeUrlDto`.
 * @returns El destino del análisis; con `address` vacío si el dominio no
 * resuelve.
 * @throws {@link BadRequestException} si la URL no se puede leer, usa un
 * puerto distinto de 80/443 o apunta a una dirección interna.
 */
export async function resolveTarget(raw: string): Promise<Target> {
  const normalized = normalizeUrl(raw);
  const addresses = await resolve(normalized.hostname);
  if (addresses.some(isPrivate)) {
    throw new BadRequestException(
      'url apunta a una dirección interna y no se puede analizar',
    );
  }
  // Una IPv4 mapeada se guarda como IPv4: es a lo que se conectan los sockets.
  return {
    ...normalized,
    address: addresses[0] && unmapIPv4(addresses[0]),
  };
}

/**
 * Dice si un host resuelve solo a direcciones públicas. Sirve para validar
 * destinos que no escogió el usuario pero que tampoco son de fiar del todo,
 * como la redirección que contesta un servicio RDAP.
 *
 * @returns `false` si el host no resuelve, tarda en resolver o alguna de sus
 * direcciones es interna.
 */
export async function isPublicHost(hostname: string): Promise<boolean> {
  const addresses = await resolve(hostname);
  return addresses.length > 0 && !addresses.some(isPrivate);
}

/**
 * Host de una URL guardada en `SitioWeb_URL.url_texto`. Las de los reportes
 * pueden venir sin protocolo (`banco.com/login`), así que se intenta también
 * con `http://` por delante.
 *
 * @returns El host normalizado, o `undefined` si el texto no es una URL.
 */
export function hostnameOf(text: string): string | undefined {
  for (const candidate of [text, 'http://' + text]) {
    try {
      const parsed = new URL(candidate.trim());
      // `banco.com:8080/x` se lee como protocolo "banco.com:" sin host.
      if (parsed.hostname) return cleanHostname(parsed);
    } catch {
      // No era una URL con este formato: se prueba el siguiente.
    }
  }
  return undefined;
}

/**
 * `new URL` ya dejó el host en minúsculas y en punycode; a una IPv6 le
 * quitamos los corchetes y a un dominio el punto final ("ejemplo.com.").
 */
function cleanHostname(parsed: URL): string {
  return parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

/**
 * Direcciones a las que resuelve un host; vacío si el dominio no existe o
 * el DNS tarda más de {@link DNS_TIMEOUT}. Si el host ya es una IP, regresa
 * esa misma.
 */
async function resolve(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  try {
    // `lookup` no se puede cancelar: si el DNS se cuelga (suele reintentar
    // a los 5 s) dejamos de esperarlo para no pasarnos del tiempo de RNF01.
    const found = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), DNS_TIMEOUT).unref(),
      ),
    ]);
    // Algunos DNS (routers, bloqueadores de anuncios) contestan 0.0.0.0 en
    // vez de "no existe": cuenta como que el dominio no resuelve.
    return found
      .map((a) => a.address)
      .filter((a) => a !== '0.0.0.0' && a !== '::');
  } catch {
    return [];
  }
}

/** Dice si una IP cae en alguno de los rangos de {@link PRIVATE}. */
function isPrivate(address: string): boolean {
  const version = isIP(address);
  // Lo que no es una IP no se deja pasar: ante la duda, se bloquea.
  if (version === 0) return true;
  // Una IPv4 escrita como IPv6 se revisa como IPv4, para que no se cuele una
  // dirección privada con ese disfraz.
  const ip = unmapIPv4(address);
  return PRIVATE.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Si `address` es una IPv4 "mapeada" en IPv6, regresa la IPv4; si no, la
 * misma dirección.
 *
 * Hay dos formas de escribirla y las dos significan lo mismo:
 * `::ffff:127.0.0.1` (con puntos) y `::ffff:7f00:1` (hexadecimal). `new URL`
 * serializa siempre la segunda, y `dns.lookup` puede regresar la primera, así
 * que las dos se pasan por la forma canónica de WHATWG antes de decidir.
 */
function unmapIPv4(address: string): string {
  if (isIP(address) !== 6) return address;
  let canonical: string;
  try {
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    // Por ejemplo `fe80::1%eth0` (con zona): `PRIVATE` la revisa tal cual.
    return address;
  }
  const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

/**
 * Versión de una URL guardada que se puede mostrar a CUALQUIER usuario con
 * sesión (`GET /risk`): sin cadena de consulta, fragmento ni `usuario:clave@`.
 * Los reportes conservan la URL completa porque es evidencia para la
 * Policía; las consultas abiertas no tienen por qué devolver los datos de la
 * víctima que suelen ir en la consulta.
 */
export function redactUrl(stored: string): string {
  try {
    const parsed = new URL(stored);
    parsed.search = '';
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return stored.split(/[?#]/)[0];
  }
}

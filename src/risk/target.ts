/**
 * Normaliza la URL que se va a analizar y decide si el servidor se puede
 * conectar a ella.
 *
 * El análisis (RF07) hace que el servidor abra conexiones hacia un host que
 * escoge el usuario. Sin filtro, alguien podría pedir que "analicemos"
 * `http://localhost:3306` o `http://192.168.1.1` y usar la API para asomarse
 * a la red interna (SSRF). Por eso aquí se resuelve el DNS una sola vez y se
 * rechazan las direcciones que no son públicas.
 */
import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Puertos a los que el análisis se puede conectar. */
const ALLOWED_PORTS = [80, 443];

/** Lo que se espera a que el DNS conteste, en milisegundos. */
const DNS_TIMEOUT = 2000;

/** Rangos que no son de internet: loopback, redes privadas, link-local, etc. */
const PRIVATE = new BlockList();
PRIVATE.addSubnet('0.0.0.0', 8);
PRIVATE.addSubnet('10.0.0.0', 8);
PRIVATE.addSubnet('100.64.0.0', 10);
PRIVATE.addSubnet('127.0.0.0', 8);
PRIVATE.addSubnet('169.254.0.0', 16);
PRIVATE.addSubnet('172.16.0.0', 12);
PRIVATE.addSubnet('192.168.0.0', 16);
PRIVATE.addSubnet('224.0.0.0', 4);
PRIVATE.addSubnet('240.0.0.0', 4);
PRIVATE.addAddress('::', 'ipv6');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');
PRIVATE.addSubnet('ff00::', 8, 'ipv6');

/** A dónde se van a conectar las verificaciones del análisis. */
export interface Target {
  /** La URL normalizada: host en minúsculas, sin fragmento. */
  url: string;
  /** Host sin puerto ni corchetes, en minúsculas (punycode si traía acentos). */
  hostname: string;
  protocol: 'http' | 'https';
  port: number;
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
 * Normaliza una URL sin conectarse a nada: host en minúsculas, sin
 * fragmento. Dos formas de escribir la misma URL dan el mismo resultado,
 * que es la llave con la que se guarda su análisis.
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
  // El fragmento (#...) nunca llega al servidor, así que no cambia el sitio.
  parsed.hash = '';
  return {
    url: parsed.toString(),
    hostname: cleanHostname(parsed),
    protocol,
    port,
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
  return { ...normalized, address: addresses[0] };
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
  // `::ffff:10.0.0.1` es una IPv4 escrita como IPv6: se revisa como IPv4
  // para que no se cuele una dirección privada con ese disfraz.
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return PRIVATE.check(mapped[1], 'ipv4');
  return PRIVATE.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

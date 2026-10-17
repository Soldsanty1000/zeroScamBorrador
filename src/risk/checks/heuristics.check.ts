/**
 * Análisis heurístico de la estructura de una URL: señales que suelen
 * aparecer en sitios de phishing y que se ven sin conectarse a nada.
 */
import { isIP } from 'node:net';
import { domainToUnicode } from 'node:url';
import type { Target } from '../target';
import { CheckResult } from './check-result';

/**
 * Marcas que más se suplantan en México y sus dominios oficiales, incluidos
 * los de su propia infraestructura (CDN, APIs): un host que se parece a la
 * marca pero no está en sus dominios es sospechoso.
 */
const BRANDS: Record<string, string[]> = {
  // Bancos y pagos
  bbva: ['bbva.mx', 'bbva.com', 'bbva.es'],
  banamex: ['banamex.com', 'citibanamex.com'],
  citibanamex: ['citibanamex.com'],
  santander: [
    'santander.com.mx',
    'santander.com',
    'santander.es',
    'santander.de',
    'santander.co.uk',
    'santander.com.br',
    'santander.cl',
  ],
  banorte: ['banorte.com'],
  hsbc: ['hsbc.com.mx', 'hsbc.com', 'hsbc.co.uk'],
  scotiabank: ['scotiabank.com.mx', 'scotiabank.com', 'scotiabankchile.cl'],
  bancoazteca: ['bancoazteca.com.mx'],
  bancoppel: ['bancoppel.com'],
  inbursa: ['inbursa.com'],
  banregio: ['banregio.com'],
  spei: ['banxico.org.mx'],
  mercadolibre: [
    'mercadolibre.com.mx',
    'mercadolibre.com',
    'mercadolibre.com.ar',
    'mercadolibre.com.co',
    'mercadolibre.cl',
    'mercadolivre.com.br',
    'mlstatic.com',
  ],
  mercadopago: ['mercadopago.com.mx', 'mercadopago.com', 'mercadopago.com.ar'],
  paypal: ['paypal.com', 'paypalobjects.com'],
  // Gobierno y servicios
  sat: ['sat.gob.mx'],
  imss: ['imss.gob.mx'],
  issste: ['issste.gob.mx'],
  infonavit: ['infonavit.org.mx'],
  cfe: ['cfe.mx', 'cfe.gob.mx'],
  telmex: ['telmex.com'],
  telcel: ['telcel.com'],
  // Paquetería
  dhl: ['dhl.com', 'dhl.com.mx', 'dhl.de'],
  fedex: ['fedex.com'],
  estafeta: ['estafeta.com'],
  correosdemexico: ['correosdemexico.gob.mx'],
  // Tiendas
  amazon: [
    'amazon.com.mx',
    'amazon.com',
    'amazon.dev',
    'media-amazon.com',
    'amazonvideo.com',
    'amazon-adsystem.com',
    'ssl-images-amazon.com',
    'amazontrust.com',
  ],
  liverpool: ['liverpool.com.mx'],
  coppel: ['coppel.com'],
  elektra: ['elektra.com.mx'],
  walmart: ['walmart.com.mx', 'walmart.com'],
  oxxo: ['oxxo.com'],
  shein: ['shein.com', 'shein.com.mx'],
  temu: ['temu.com'],
  // Plataformas
  netflix: ['netflix.com', 'netflix.net', 'nflxvideo.net', 'nflximg.net'],
  spotify: ['spotify.com', 'spotifycdn.com', 'scdn.co'],
  facebook: ['facebook.com', 'facebook.net', 'fbcdn.net', 'fb.com'],
  instagram: ['instagram.com', 'cdninstagram.com'],
  whatsapp: ['whatsapp.com', 'whatsapp.net'],
  google: [
    'google.com',
    'google.com.mx',
    'googlevideo.com',
    'googletagmanager.com',
    'googlesyndication.com',
    'googleadservices.com',
    'google-analytics.com',
    'googledomains.com',
    'googletagservices.com',
    'googleblog.com',
    'withgoogle.com',
    'gstatic.com',
  ],
  microsoft: [
    'microsoft.com',
    'microsoftonline.com',
    'live.com',
    'office.com',
    'outlook.com',
  ],
  apple: [
    'apple.com',
    'icloud.com',
    'apple-dns.net',
    'cdn-apple.com',
    'apple-cloudkit.com',
  ],
  uber: ['uber.com'],
};

/**
 * Dominios por país de las marcas globales que sí son suyos. Va como lista
 * explícita: deducirlo del nombre (`<marca>.<país>`) aceptaría también un
 * `paypal.com.co` registrado por cualquiera.
 */
const COUNTRY_DOMAINS = [
  ...[
    'de',
    'es',
    'fr',
    'it',
    'nl',
    'pl',
    'ca',
    'cn',
    'co.uk',
    'co.jp',
    'co.in',
    'com.br',
    'com.ar',
    'com.co',
    'com.hk',
    'com.au',
    'cl',
  ].map((cc) => `google.${cc}`),
  ...[
    'de',
    'es',
    'fr',
    'it',
    'nl',
    'pl',
    'se',
    'ca',
    'cn',
    'in',
    'sg',
    'ae',
    'sa',
    'co.uk',
    'co.jp',
    'co.za',
    'com.br',
    'com.au',
    'com.tr',
  ].map((cc) => `amazon.${cc}`),
  'dhl.es',
  'dhl.co.uk',
];

/**
 * Hosting compartido: cualquiera crea ahí un subdominio
 * (`banco-seguridad.s3.amazonaws.com`). El dominio en sí no imita a nadie,
 * pero lo que va antes lo escribe el cliente y se analiza igual.
 */
const SHARED_HOSTING = [
  'amazonaws.com',
  'cloudfront.net',
  'googleapis.com',
  'googleusercontent.com',
  'appspot.com',
  'firebaseapp.com',
  'web.app',
  'microsoftpersonalcontent.com',
  'azurewebsites.net',
  'blob.core.windows.net',
  'github.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'herokuapp.com',
  'onrender.com',
  'blogspot.com',
  'wixsite.com',
  'weebly.com',
  '000webhostapp.com',
  'ngrok.io',
  'ngrok-free.app',
];

/** Marcas dueñas de su propia terminación: todo `*.google` es de Google. */
const BRAND_TLDS = ['google', 'microsoft', 'apple', 'amazon'];

/** Números que se usan para imitar letras: `paypa1`, `amaz0n`. */
const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
};

/**
 * Letras cirílicas y griegas que se ven igual que una latina: `аррӏе` (todo
 * cirílico) se lee "apple".
 */
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ԁ: 'd',
  ӏ: 'l',
  ѕ: 's',
  һ: 'h',
  ԛ: 'q',
  ԝ: 'w',
  к: 'k',
  м: 'm',
  т: 't',
  в: 'b',
  н: 'h',
  α: 'a',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  υ: 'u',
  χ: 'x',
  β: 'b',
};

/**
 * Palabras de anzuelo que se pegan al nombre para parecer un trámite
 * oficial: `banco-verifica`, `paquete-retenido`.
 */
const BAIT = new Set([
  'seguridad',
  'seguro',
  'segura',
  'verifica',
  'verificar',
  'verificacion',
  'soporte',
  'alerta',
  'alertas',
  'actualiza',
  'actualizar',
  'actualizacion',
  'desbloqueo',
  'desbloquear',
  'bloqueo',
  'reembolso',
  'devolucion',
  'premio',
  'premios',
  'sorteo',
  'ganador',
  'regalo',
  'pago',
  'pagos',
  'aclaracion',
  'aclaraciones',
  'validar',
  'validacion',
  'confirmar',
  'retenido',
  'retenida',
  'cita',
  'citas',
  'enlinea',
  'secure',
  'verify',
  'update',
  'signin',
  'unlock',
  'wallet',
  'bonus',
  'refund',
]);

/**
 * Terminaciones que, según los reportes de abuso (Spamhaus, Interisle),
 * concentran una parte desproporcionada del phishing por ser baratas.
 */
const ABUSED_TLDS = new Set([
  'xyz',
  'top',
  'online',
  'site',
  'click',
  'icu',
  'buzz',
  'cyou',
  'rest',
  'lat',
  'live',
  'support',
  'help',
  'cfd',
  'sbs',
  'bond',
  'monster',
  'quest',
  'work',
  'loan',
  'win',
  'bid',
  'tk',
  'ml',
  'ga',
  'cf',
  'gq',
]);

/** Puntos de riesgo de cada señal. */
const POINTS = {
  ipHost: 30,
  credentials: 25,
  mixedScripts: 30,
  accents: 10,
  brand: 35,
  government: 35,
  bait: 10,
  sharedHosting: 10,
  abusedTld: 10,
  subdomains: 10,
  longUrl: 5,
};

/**
 * Busca señales de phishing en la estructura de la URL.
 *
 * @param target - Destino ya normalizado por `resolveTarget`.
 * @returns `passed: true` si no hay ninguna señal; si las hay, `detail` las
 * enumera y `points` es la suma (máximo 100).
 */
export function checkHeuristics(target: Target): CheckResult {
  const signals: string[] = [];
  let points = 0;
  const add = (signal: string, value: number) => {
    signals.push(signal);
    points += value;
  };
  const url = new URL(target.url);
  const ip = Boolean(isIP(target.hostname));
  // El host como se lee: `xn--` decodificado a sus letras reales.
  const unicode = ip ? target.hostname : domainToUnicode(target.hostname);
  const allLabels = unicode.split('.');
  const hosting = ip ? undefined : sharedHosting(target.hostname);
  // En hosting compartido solo cuenta lo que escribió el cliente.
  const labels = hosting
    ? allLabels.slice(0, allLabels.length - hosting.split('.').length)
    : allLabels;
  const official = !ip && !hosting && isOfficial(target.hostname);

  if (ip) {
    add('usa una dirección IP en vez de un dominio', POINTS.ipHost);
  }
  // `https://banco.com@malo.com` lleva a malo.com: lo de antes del @ es un
  // nombre de usuario, no el sitio.
  if (url.username) {
    add('tiene un @ que esconde el dominio real', POINTS.credentials);
  }
  if (hosting && labels.length > 0) {
    add(
      `está en un hosting donde cualquiera puede publicar (${hosting})`,
      POINTS.sharedHosting,
    );
  }
  if (!ip && !official && labels.length > 0) {
    // Un dominio internacional escrito todo en su alfabeto es normal; lo
    // sospechoso es mezclar alfabetos en una palabra (una "а" cirílica entre
    // letras latinas) o acentos que hacen pasar una letra por otra.
    if (labels.some(mixesScripts)) {
      add(
        'mezcla letras de distintos alfabetos para imitar otras',
        POINTS.mixedScripts,
      );
    } else if (labels.some((label) => /[à-ÿ]/i.test(label))) {
      add(
        'usa caracteres especiales (acentos) que se confunden con letras normales',
        POINTS.accents,
      );
    }
    const brand = imitatedBrand(labels);
    if (brand) {
      add(`se parece a "${brand}" pero no es su dominio oficial`, POINTS.brand);
    }
    if (posesAsGovernment(labels)) {
      add(
        'aparenta ser de gobierno pero no es un dominio .gob.mx',
        POINTS.government,
      );
    }
    const bait = words(labels).find((word) => BAIT.has(word));
    if (bait) {
      add(`usa una palabra de anzuelo ("${bait}")`, POINTS.bait);
    }
    if (ABUSED_TLDS.has(labels[labels.length - 1])) {
      add(
        `usa una terminación muy usada en fraudes (.${labels[labels.length - 1]})`,
        POINTS.abusedTld,
      );
    }
  }
  if (!ip && labels.length >= 5) {
    add('tiene demasiados subdominios', POINTS.subdomains);
  }
  if (target.url.length > 150) {
    add('es inusualmente larga', POINTS.longUrl);
  }

  if (signals.length === 0) {
    return {
      name: 'heuristics',
      passed: true,
      detail: 'Sin señales sospechosas en la estructura de la URL',
      points: 0,
    };
  }
  return {
    name: 'heuristics',
    passed: false,
    detail: 'La URL ' + signals.join('; '),
    points: Math.min(points, 100),
  };
}

/** `true` si el host es de una marca de la lista o de su terminación propia. */
function isOfficial(hostname: string): boolean {
  const owns = (domain: string) =>
    hostname === domain || hostname.endsWith('.' + domain);
  return (
    Object.values(BRANDS).some((domains) => domains.some(owns)) ||
    COUNTRY_DOMAINS.some(owns) ||
    BRAND_TLDS.some((tld) => hostname.endsWith('.' + tld))
  );
}

/** El dominio de hosting compartido del host, si está en uno. */
function sharedHosting(hostname: string): string | undefined {
  return SHARED_HOSTING.find(
    (domain) => hostname === domain || hostname.endsWith('.' + domain),
  );
}

/** Las palabras del host: `bbva-seguro.login.com` → bbva, seguro, login, com. */
function words(labels: string[]): string[] {
  return labels.flatMap((label) => label.split('-')).filter(Boolean);
}

/**
 * Formas en que se lee una palabra: tal cual, sin acentos, con las letras
 * cirílicas o griegas que imitan latinas cambiadas, con números en vez de
 * letras (`paypa1` → paypal) y con pares que se confunden ("rn" → "m",
 * "vv" → "w").
 */
function readings(word: string): string[] {
  const latin = [...word.normalize('NFD').replace(/\p{M}/gu, '')]
    .map((char) => CONFUSABLES[char] ?? char)
    .join('');
  const digits = latin.replace(/[013457]/g, (digit) => LOOKALIKES[digit]);
  const pairs = (text: string) => text.replace(/rn/g, 'm').replace(/vv/g, 'w');
  return [...new Set([word, latin, digits, pairs(latin), pairs(digits)])];
}

/**
 * Marca que el host intenta imitar (typosquatting), si hay alguna.
 *
 * @param labels - El host ya decodificado, partido por puntos.
 * @returns El nombre de la marca, o `undefined` si no se parece a ninguna.
 */
function imitatedBrand(labels: string[]): string | undefined {
  const candidates = words(labels).flatMap(readings);
  for (const brand of Object.keys(BRANDS)) {
    // Entre más larga la marca, más errores de dedo se toleran. Las cortas
    // (sat, dhl, bbva) solo cuentan si aparecen exactas: a una letra de
    // distancia hay demasiadas palabras normales.
    const tolerance = brand.length >= 8 ? 2 : brand.length >= 5 ? 1 : 0;
    const similar = candidates.some(
      (word) =>
        distance(word, brand) <= tolerance ||
        (brand.length >= 5 && word.includes(brand)),
    );
    if (similar) return brand;
  }
  return undefined;
}

/**
 * `true` si el host usa "gob" o "gov" sin ser un dominio de gobierno:
 * `sat-gob-mx.com` aparenta serlo, `sat.gob.mx` sí lo es.
 */
function posesAsGovernment(labels: string[]): boolean {
  const host = labels.join('.');
  const real = /(^|\.)(gob|gov)(\.[a-z]{2})?$/.test(host);
  return (
    !real &&
    words(labels).some(
      (word) => word === 'gob' || word === 'gov' || word.startsWith('gobierno'),
    )
  );
}

/** `true` si una palabra mezcla letras latinas con cirílicas o griegas. */
function mixesScripts(label: string): boolean {
  const latin = /\p{Script=Latin}/u.test(label);
  const other = /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(label);
  // Todo en cirílico pero que se lee como una marca también engaña; eso lo
  // atrapa `imitatedBrand` con sus lecturas.
  return latin && other;
}

/**
 * Distancia de Levenshtein: cuántas letras hay que insertar, borrar o
 * cambiar para pasar de `a` a `b`.
 */
function distance(a: string, b: string): number {
  // `row[j]` es la distancia entre lo recorrido de `a` y los primeros j
  // caracteres de `b`; se reutiliza una sola fila de la matriz.
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[b.length];
}

/**
 * Análisis heurístico de la estructura de una URL: señales que suelen
 * aparecer en sitios de phishing y que se ven sin conectarse a nada.
 */
import { isIP } from 'node:net';
import type { Target } from '../target';
import { CheckResult } from './check-result';

/**
 * Marcas que más se suplantan y sus dominios oficiales. Un host que se
 * parece a la marca pero no está en sus dominios es sospechoso.
 */
const BRANDS: Record<string, string[]> = {
  bbva: ['bbva.mx', 'bbva.com'],
  banamex: ['banamex.com', 'citibanamex.com'],
  citibanamex: ['citibanamex.com'],
  santander: ['santander.com.mx', 'santander.com'],
  banorte: ['banorte.com'],
  hsbc: ['hsbc.com.mx', 'hsbc.com'],
  scotiabank: ['scotiabank.com.mx', 'scotiabank.com'],
  bancoazteca: ['bancoazteca.com.mx'],
  mercadolibre: ['mercadolibre.com.mx', 'mercadolibre.com'],
  mercadopago: ['mercadopago.com.mx', 'mercadopago.com'],
  amazon: ['amazon.com.mx', 'amazon.com'],
  paypal: ['paypal.com'],
  liverpool: ['liverpool.com.mx'],
  coppel: ['coppel.com'],
  walmart: ['walmart.com.mx', 'walmart.com'],
  telcel: ['telcel.com'],
  netflix: ['netflix.com'],
  spotify: ['spotify.com'],
  facebook: ['facebook.com'],
  instagram: ['instagram.com'],
  whatsapp: ['whatsapp.com'],
  google: ['google.com', 'google.com.mx'],
  microsoft: ['microsoft.com'],
  apple: ['apple.com'],
};

/** Números que se usan para imitar letras: `paypa1`, `amaz0n`. */
const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
};

/** Puntos de riesgo de cada señal. */
const POINTS = {
  ipHost: 30,
  credentials: 25,
  punycode: 20,
  brand: 35,
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
  const labels = target.hostname.split('.');

  if (isIP(target.hostname)) {
    add('usa una dirección IP en vez de un dominio', POINTS.ipHost);
  }
  // `https://banco.com@malo.com` lleva a malo.com: lo de antes del @ es un
  // nombre de usuario, no el sitio.
  if (url.username) {
    add('tiene un @ que esconde el dominio real', POINTS.credentials);
  }
  // `xn--` es un dominio con caracteres no latinos: puede imitar letras
  // (homóglifos), como una "а" cirílica en vez de la "a".
  if (labels.some((label) => label.startsWith('xn--'))) {
    add('usa caracteres especiales que pueden imitar letras', POINTS.punycode);
  }
  const brand = isIP(target.hostname) ? undefined : imitatedBrand(labels);
  if (brand) {
    add(`se parece a "${brand}" pero no es su dominio oficial`, POINTS.brand);
  }
  if (!isIP(target.hostname) && labels.length >= 5) {
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

/**
 * Marca que el host intenta imitar (typosquatting), si hay alguna.
 *
 * @param labels - El host partido por puntos.
 * @returns El nombre de la marca, o `undefined` si el host es un dominio
 * oficial o no se parece a ninguna.
 */
function imitatedBrand(labels: string[]): string | undefined {
  const hostname = labels.join('.');
  // `bbva-seguro.login.com` → bbva, seguro, login, com.
  const words = labels.flatMap((label) => label.split('-')).map(unmask);
  for (const [brand, domains] of Object.entries(BRANDS)) {
    const official = domains.some(
      (d) => hostname === d || hostname.endsWith('.' + d),
    );
    if (official) continue;
    // Entre más larga la marca, más errores de dedo se toleran. Las cortas
    // (bbva, hsbc) solo cuentan si aparecen exactas: a una letra de
    // distancia hay demasiadas palabras normales.
    const tolerance = brand.length >= 8 ? 2 : brand.length >= 5 ? 1 : 0;
    const similar = words.some(
      (word) =>
        distance(word, brand) <= tolerance ||
        (brand.length >= 5 && word.includes(brand)),
    );
    if (similar) return brand;
  }
  return undefined;
}

/** Cambia los números que imitan letras por la letra: `paypa1` → `paypal`. */
function unmask(word: string): string {
  return word.replace(/[013457]/g, (digit) => LOOKALIKES[digit]);
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

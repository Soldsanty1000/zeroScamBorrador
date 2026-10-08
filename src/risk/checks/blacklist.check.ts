/**
 * Listas negras: pregunta a Google Safe Browsing si la URL ya está
 * registrada como maliciosa (phishing, malware…).
 *
 * Es la única verificación que depende de un servicio con llave. Sin
 * `SAFE_BROWSING_API_KEY` en `.env` no se hace la consulta y el análisis
 * sigue con las demás verificaciones.
 */
import type { Target } from '../target';
import { CheckResult } from './check-result';

/** Lookup API v4: se manda la URL y regresa las listas en las que aparece. */
const API_URL = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

/** Lo que se espera a que Google conteste, en milisegundos. */
const TIMEOUT = 2000;

/** Estar en una lista negra es la señal más fuerte: el máximo de puntos. */
const POINTS = 100;

/** Tipos de amenaza que se consultan, con el nombre que ve el usuario. */
const THREATS: Record<string, string> = {
  SOCIAL_ENGINEERING: 'phishing',
  MALWARE: 'malware',
  UNWANTED_SOFTWARE: 'software no deseado',
  POTENTIALLY_HARMFUL_APPLICATION: 'aplicación potencialmente dañina',
};

/**
 * Consulta la URL en Google Safe Browsing.
 *
 * @param target - Destino ya normalizado por `resolveTarget`.
 * @returns `passed: false` con 100 puntos y `minLevel: MUY_ALTO` si la URL
 * está en alguna lista. Si no hay llave o Google no contesta regresa
 * `passed: true` con 0 puntos y lo explica en `detail`.
 */
export async function checkBlacklist(target: Target): Promise<CheckResult> {
  const key = process.env.SAFE_BROWSING_API_KEY;
  if (!key) {
    return blacklistResult(undefined, 'Lista negra no configurada');
  }
  const threats = await fetchThreats(target.url, key);
  if (!threats) {
    return blacklistResult(undefined, 'No se pudo consultar la lista negra');
  }
  return blacklistResult(threats);
}

/**
 * Arma el resultado a partir de lo que contestó la lista negra.
 *
 * @param threats - Tipos de amenaza con los que aparece la URL (vacío si no
 * aparece); `undefined` si no se pudo consultar.
 * @param reason - Por qué no se pudo consultar, cuando `threats` no viene.
 */
export function blacklistResult(
  threats: string[] | undefined,
  reason = 'No se pudo consultar la lista negra',
): CheckResult {
  if (!threats) {
    return { name: 'blacklist', passed: true, detail: reason, points: 0 };
  }
  if (threats.length === 0) {
    return {
      name: 'blacklist',
      passed: true,
      detail: 'No aparece en la lista negra de Google Safe Browsing',
      points: 0,
    };
  }
  // Set: la misma amenaza llega una vez por cada plataforma en que aplica.
  const names = [...new Set(threats.map((t) => THREATS[t] ?? t))];
  return {
    name: 'blacklist',
    passed: false,
    detail: 'Google Safe Browsing la tiene registrada como ' + names.join(', '),
    points: POINTS,
    // Una URL en lista negra es MUY_ALTO aunque nada más la delate.
    minLevel: 'MUY_ALTO',
  };
}

/**
 * Pregunta a Safe Browsing por una URL.
 *
 * @returns Los `threatType` con los que aparece (vacío si está limpia), o
 * `undefined` si Google no contesta a tiempo o rechaza la llave.
 */
async function fetchThreats(
  url: string,
  key: string,
): Promise<string[] | undefined> {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        'content-type': 'application/json',
        // La llave va en un encabezado y no en la URL para que no quede en
        // bitácoras de peticiones.
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        client: { clientId: 'zeroscam', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: Object.keys(THREATS),
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }),
    });
    if (!response.ok) return undefined;
    // Una URL limpia regresa `{}`, sin `matches`.
    const body = (await response.json()) as {
      matches?: { threatType: string }[];
    };
    return (body.matches ?? []).map((m) => m.threatType);
  } catch {
    return undefined;
  }
}

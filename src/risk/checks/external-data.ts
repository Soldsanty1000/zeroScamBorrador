/**
 * Utilidades para tratar datos que vienen de fuera: el certificado que
 * presenta un sitio (lo controla quien lo montó) y las respuestas de los
 * servicios externos (RDAP, Safe Browsing).
 *
 * Nada de esto es de fiar: el texto del certificado se devuelve a otros
 * usuarios y se guarda en la base, y un cuerpo HTTP sin tope se puede usar
 * para llenar la memoria del servidor.
 */

/**
 * Todo lo que no es texto visible: caracteres de control, de formato
 * (marcas bidireccionales, ancho cero, BOM), sin asignar y de uso privado
 * (`\p{C}`), más algunos "espacios" que se dibujan en blanco aunque no son
 * de ninguna de esas categorías (relleno hangul, braille en blanco). Se
 * quitan `<` y `>` para que el texto no pueda colarse como HTML en un
 * cliente que no lo escape.
 */
const INVISIBLE = /[\p{C}ᅟᅠㅤﾠ⠀<>]/gu;

/**
 * Deja un texto ajeno listo para mostrarse y guardarse: sin caracteres de
 * control ni invisibles, con los espacios colapsados y recortado a `max`
 * caracteres (un `…` al final avisa que se cortó).
 *
 * @param value - Lo que trae el certificado o el servicio externo; un
 * arreglo (campo repetido en el certificado) se une con comas.
 * @param max - Largo máximo del resultado, en caracteres.
 * @returns El texto limpio; cadena vacía si no venía nada visible.
 */
export function cleanText(value: unknown, max = 64): string {
  if (value === undefined || value === null) return '';
  let raw = '';
  if (Array.isArray(value)) raw = value.join(', ');
  else if (typeof value === 'string') raw = value;
  else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    raw = String(value);
  }
  const text = raw
    // Saltos de línea y tabuladores separan palabras; no se borran.
    .replace(/\s+/g, ' ')
    .replace(INVISIBLE, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  // `Array.from` cuenta caracteres y no unidades UTF-16, para no partir un
  // emoji a la mitad.
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()
    .concat('…');
}

/**
 * Lee el cuerpo de una respuesta HTTP como JSON sin pasar de `maxBytes`.
 *
 * `response.json()` baja todo lo que mande el servidor; con un servidor
 * malicioso (o un registro con un error) eso es memoria sin límite. Aquí se
 * corta en cuanto se rebasa el tope, se cancela la lectura y se libera la
 * conexión. El tiempo total lo sigue limitando el `AbortSignal` del `fetch`.
 *
 * @throws `Error` si el cuerpo pesa más de `maxBytes`, no hay cuerpo o no es
 * JSON.
 */
export async function readJsonLimited(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  // El encabezado es un aviso del servidor, no una garantía: solo sirve para
  // rechazar rápido. El tope de verdad se aplica mientras se lee.
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('La respuesta es demasiado grande');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('La respuesta no trae cuerpo');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('La respuesta es demasiado grande');
      chunks.push(value);
    }
  } catch (error) {
    // Sin esto la conexión se queda abierta mandando datos que nadie lee.
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

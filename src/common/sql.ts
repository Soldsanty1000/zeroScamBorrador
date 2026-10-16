/**
 * Escapa `\`, `%` y `_` de un texto que se va a usar dentro de un `LIKE`, para
 * que el usuario busque literalmente lo que escribió y no comodines. El valor
 * escapado se pasa SIEMPRE como parámetro (`LIKE ?`), nunca pegado al SQL.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Patrón `%texto%` listo para pasarlo como parámetro de un `LIKE`. */
export function containsPattern(text: string): string {
  return `%${escapeLike(text)}%`;
}

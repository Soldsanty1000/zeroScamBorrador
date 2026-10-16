import { BadRequestException } from '@nestjs/common';

/**
 * Limpieza de archivos subidos (evidencias y avatares), del lado del servidor:
 * no se confía en que el cliente haya limpiado nada.
 */

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
/** Segmentos que llevan metadatos: EXIF y XMP (APP1), IPTC (APP13) y comentarios. */
const METADATA_MARKERS = new Set([0xe1, 0xed, 0xfe]);

function corrupt(): never {
  throw new BadRequestException('La imagen JPEG está dañada o no es válida');
}

/**
 * Quita de un JPEG los metadatos (ubicación GPS, modelo del teléfono, fecha,
 * comentarios) sin recodificar los píxeles. Conserva JFIF, perfiles de color y
 * todo lo necesario para mostrarlo.
 * @throws {@link BadRequestException} si la estructura del JPEG es inválida.
 */
export function stripJpegMetadata(jpeg: Buffer): Buffer {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== SOI) corrupt();
  const parts: Buffer[] = [jpeg.subarray(0, 2)];
  let i = 2;
  while (i < jpeg.length) {
    if (jpeg[i] !== 0xff) corrupt();
    while (jpeg[i] === 0xff) i++; // bytes de relleno antes del marcador
    const marker = jpeg[i++];
    if (marker === undefined) corrupt();
    if (marker === EOI) {
      parts.push(Buffer.from([0xff, EOI]));
      break;
    }
    // Marcadores sin longitud: TEM y RSTn.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(Buffer.from([0xff, marker]));
      continue;
    }
    if (i + 2 > jpeg.length) corrupt();
    const length = jpeg.readUInt16BE(i);
    if (length < 2 || i + length > jpeg.length) corrupt();
    if (marker === SOS) {
      // Desde aquí vienen los datos comprimidos hasta el final: se copian tal cual.
      parts.push(jpeg.subarray(i - 2));
      return Buffer.concat(parts);
    }
    if (!METADATA_MARKERS.has(marker))
      parts.push(jpeg.subarray(i - 2, i + length));
    i += length;
  }
  return Buffer.concat(parts);
}

/** Nombres de PDF que ejecutan código, lanzan programas, incrustan archivos o cifran. */
const PDF_ACTIVE =
  /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA|Encrypt|SubmitForm|ImportData|GoToR)(?![A-Za-z0-9])/;

/**
 * Detecta contenido activo en un PDF (JavaScript, acciones de lanzamiento,
 * archivos incrustados, formularios, cifrado). Deshace los escapes `#xx` que
 * usan los PDF maliciosos para esconder los nombres (`/J#61vaScript`).
 *
 * Es una revisión de buena fe sobre el texto del archivo: no ve dentro de
 * flujos comprimidos, así que no sustituye a un antivirus.
 * @returns El nombre peligroso encontrado, o `undefined` si no hay.
 */
export function pdfActiveContent(pdf: Buffer): string | undefined {
  const text = pdf
    .toString('latin1')
    .replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  return PDF_ACTIVE.exec(text)?.[1];
}

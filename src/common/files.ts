import { BadRequestException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { evidenceKey } from '../config';
import { pdfActiveContent, stripJpegMetadata } from './sanitize';

/**
 * Evidencias: carpeta en disco. YA NO se sirve como estático: los archivos solo
 * salen por endpoints autenticados que revisan quién puede verlos.
 */
export const UPLOADS_DIR = 'uploads';
/** Avatares: fuera de `uploads/`, solo salen por `GET /account/avatar/:id`. */
export const AVATARS_DIR = join('storage', 'avatars');

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const TYPES = [
  {
    mime: 'image/jpeg',
    ext: '.jpg',
    magic: [0xff, 0xd8, 0xff],
    max: MAX_IMAGE_BYTES,
  },
  {
    mime: 'application/pdf',
    ext: '.pdf',
    magic: [0x25, 0x50, 0x44, 0x46, 0x2d],
    max: MAX_PDF_BYTES,
  },
];

/** Nombre que genera `storeUpload`: 32 hex aleatorios y una extensión conocida. */
export const STORED_FILE_NAME = /^[0-9a-f]{32}\.(jpg|pdf)$/;

/** Tipo MIME de un archivo guardado, a partir de su extensión. */
export function mimeOfStored(fileName: string): string | undefined {
  return TYPES.find((t) => fileName.endsWith(t.ext))?.mime;
}

// ---------- Cifrado en reposo (AES-256-GCM, RNF02) ----------

/** Marca al inicio de un archivo cifrado por esta versión. */
const MAGIC = Buffer.from('ZSE1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** `ZSE1 | iv | etiqueta de autenticación | texto cifrado`. */
function encrypt(plain: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', evidenceKey(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

/**
 * Descifra un archivo guardado. Un archivo que no trae la marca es de antes
 * del cifrado y se entrega tal cual. Lanza si fue alterado (la etiqueta de
 * GCM no cuadra).
 */
function decrypt(stored: Buffer): Buffer {
  const hasHeader = stored.length >= MAGIC.length + IV_BYTES + TAG_BYTES;
  if (!hasHeader || !stored.subarray(0, MAGIC.length).equals(MAGIC)) {
    return stored;
  }
  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = stored.subarray(
    MAGIC.length + IV_BYTES,
    MAGIC.length + IV_BYTES + TAG_BYTES,
  );
  const body = stored.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', evidenceKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** Ruta dentro de `dir`; rechaza cualquier nombre con carpetas o `..`. */
function pathOf(dir: string, fileName: string): string {
  if (basename(fileName) !== fileName || fileName.startsWith('.')) {
    throw new BadRequestException('Nombre de archivo no permitido');
  }
  return join(process.cwd(), dir, fileName);
}

/**
 * Guarda un archivo subido, cifrado, con un nombre aleatorio. El tipo se decide
 * por los primeros bytes del contenido, no por lo que diga el cliente.
 *
 * @param dir - Carpeta destino, relativa a donde corre el servidor.
 * @param content - Bytes recibidos.
 * @param allowed - Tipos MIME aceptados.
 * @returns El nombre del archivo dentro de `dir` y su tipo MIME.
 * @throws {@link BadRequestException} si el tipo no se acepta o pesa de más.
 */
export async function storeUpload(
  dir: string,
  content: Buffer,
  allowed: string[],
): Promise<{ fileName: string; mimeType: string }> {
  const type = TYPES.find(
    (t) =>
      allowed.includes(t.mime) && t.magic.every((b, i) => content[i] === b),
  );
  if (!type) throw new BadRequestException('Tipo de archivo no permitido');
  if (content.length > type.max) {
    throw new BadRequestException('El archivo es demasiado grande');
  }
  // Limpieza del lado del servidor: fotos sin metadatos, PDF sin contenido activo.
  let clean = content;
  if (type.mime === 'image/jpeg') {
    clean = stripJpegMetadata(content);
  } else if (pdfActiveContent(content)) {
    throw new BadRequestException(
      'El PDF contiene contenido activo (scripts, archivos incrustados o cifrado) y no se acepta',
    );
  }
  const fileName = randomBytes(16).toString('hex') + type.ext;
  await mkdir(join(process.cwd(), dir), { recursive: true });
  await writeFile(pathOf(dir, fileName), encrypt(clean), { mode: 0o600 });
  return { fileName, mimeType: type.mime };
}

/** Lee y descifra un archivo guardado; `undefined` si ya no está o fue alterado. */
export async function readStored(
  dir: string,
  fileName: string,
): Promise<Buffer | undefined> {
  try {
    return decrypt(await readFile(pathOf(dir, fileName)));
  } catch {
    return undefined;
  }
}

/** Borra archivos guardados; los que ya no estén se ignoran. */
export async function removeStored(
  dir: string,
  fileNames: string[],
): Promise<void> {
  await Promise.all(
    fileNames.map(async (f) => {
      try {
        await unlink(pathOf(dir, f));
      } catch {
        // ya no estaba, o el nombre no es válido: no hay nada que borrar
      }
    }),
  );
}

import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Evidencias: la carpeta que Express sirve en `/uploads/`. */
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

/**
 * Guarda un archivo subido con un nombre aleatorio. El tipo se decide por los
 * primeros bytes del contenido, no por lo que diga el cliente.
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
  const fileName = randomBytes(16).toString('hex') + type.ext;
  await mkdir(join(process.cwd(), dir), { recursive: true });
  await writeFile(join(process.cwd(), dir, fileName), content);
  return { fileName, mimeType: type.mime };
}

/** Lee un archivo guardado; `undefined` si ya no está. */
export async function readStored(
  dir: string,
  fileName: string,
): Promise<Buffer | undefined> {
  try {
    return await readFile(join(process.cwd(), dir, fileName));
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
    fileNames.map((f) =>
      unlink(join(process.cwd(), dir, f)).catch(() => undefined),
    ),
  );
}

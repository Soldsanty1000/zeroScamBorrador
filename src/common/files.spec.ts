import { BadRequestException } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readStored,
  removeStored,
  storeUpload,
  STORED_FILE_NAME,
} from './files';

const DIR = join('.tmp', 'files-spec');
/** JPEG mínimo pero válido: SOI, APP0 (JFIF), SOS con datos reconocibles y EOI. */
function validJpeg(extraSegment = Buffer.alloc(0)): Buffer {
  const jfif = Buffer.from([
    0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00,
  ]);
  const scan = Buffer.concat([
    Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02]),
    Buffer.from('contenido-secreto-de-la-evidencia'),
    Buffer.from([0xff, 0xd9]),
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, extraSegment, scan]);
}
const jpeg = validJpeg();

describe('files (evidencias cifradas)', () => {
  afterAll(() =>
    rm(join(process.cwd(), DIR), { recursive: true, force: true }),
  );

  it('quita los metadatos (GPS) antes de cifrar', async () => {
    const body = Buffer.from('Exif GPS 19.43,-99.13');
    const exif = Buffer.concat([
      Buffer.from([0xff, 0xe1, 0x00, body.length + 2]),
      body,
    ]);
    const { fileName } = await storeUpload(DIR, validJpeg(exif), [
      'image/jpeg',
    ]);
    const stored = await readStored(DIR, fileName);
    expect(stored!.includes(Buffer.from('GPS'))).toBe(false);
    expect(stored!.includes(Buffer.from('contenido-secreto'))).toBe(true);
  });

  it('guarda cifrado, con nombre aleatorio, y se lee de vuelta idéntico', async () => {
    const { fileName, mimeType } = await storeUpload(DIR, jpeg, ['image/jpeg']);
    expect(fileName).toMatch(STORED_FILE_NAME);
    expect(mimeType).toBe('image/jpeg');
    const onDisk = readFileSync(join(process.cwd(), DIR, fileName));
    expect(onDisk.subarray(0, 4).toString()).toBe('ZSE1');
    expect(onDisk.includes(Buffer.from('contenido-secreto'))).toBe(false);
    expect((await readStored(DIR, fileName))!.equals(jpeg)).toBe(true);
  });

  it('detecta un archivo alterado (GCM) y no lo entrega', async () => {
    const { fileName } = await storeUpload(DIR, jpeg, ['image/jpeg']);
    const path = join(process.cwd(), DIR, fileName);
    const data = readFileSync(path);
    data[data.length - 1] ^= 0xff;
    writeFileSync(path, data);
    expect(await readStored(DIR, fileName)).toBeUndefined();
  });

  it('entrega tal cual un archivo anterior sin cifrar', async () => {
    const fileName = 'a'.repeat(32) + '.jpg';
    writeFileSync(join(process.cwd(), DIR, fileName), jpeg);
    expect((await readStored(DIR, fileName))!.equals(jpeg)).toBe(true);
  });

  it('rechaza un PDF con contenido activo', async () => {
    await expect(
      storeUpload(
        DIR,
        Buffer.from('%PDF-1.4 <</S/JavaScript/JS(app.alert(1))>>'),
        ['application/pdf'],
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza lo que no es JPEG ni PDF por su contenido', async () => {
    await expect(
      storeUpload(DIR, Buffer.from('<html><script>alert(1)</script>'), [
        'image/jpeg',
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza nombres con carpetas o ..', async () => {
    expect(await readStored(DIR, '../../.env')).toBeUndefined();
    expect(await readStored(DIR, '/etc/passwd')).toBeUndefined();
    await removeStored(DIR, ['../../package.json']);
  });
});

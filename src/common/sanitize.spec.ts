import { BadRequestException } from '@nestjs/common';
import { pdfActiveContent, stripJpegMetadata } from './sanitize';

/** JPEG mínimo: SOI, APP0 (JFIF), APP1 (EXIF con GPS), COM, SOS y EOI. */
function jpegWith(...segments: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...segments,
    Buffer.from([
      0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9,
    ]),
  ]);
}
function segment(marker: number, payload: string): Buffer {
  const body = Buffer.from(payload);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, body]);
}

describe('stripJpegMetadata', () => {
  const original = jpegWith(
    segment(0xe0, 'JFIF\0'),
    segment(0xe1, 'Exif\0\0GPS-19.4326,-99.1332 iPhone 17'),
    segment(0xfe, 'comentario privado'),
  );

  it('quita EXIF/GPS y comentarios pero conserva JFIF y los datos de imagen', () => {
    const clean = stripJpegMetadata(original);
    expect(clean.includes(Buffer.from('GPS-19.4326'))).toBe(false);
    expect(clean.includes(Buffer.from('iPhone'))).toBe(false);
    expect(clean.includes(Buffer.from('comentario'))).toBe(false);
    expect(clean.includes(Buffer.from('JFIF'))).toBe(true);
    expect(clean.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(clean.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect(clean.includes(Buffer.from([0x11, 0x22, 0x33]))).toBe(true);
  });

  it('rechaza estructuras dañadas', () => {
    expect(() =>
      stripJpegMetadata(Buffer.from([0xff, 0xd8, 0x00, 0x00])),
    ).toThrow(BadRequestException);
    expect(() =>
      stripJpegMetadata(
        Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]),
          Buffer.alloc(10),
        ]),
      ),
    ).toThrow(BadRequestException);
  });
});

describe('pdfActiveContent', () => {
  it('acepta un PDF simple', () => {
    expect(
      pdfActiveContent(Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj')),
    ).toBeUndefined();
  });

  it.each([
    ['JavaScript', '%PDF-1.4 1 0 obj<</S/JavaScript/JS(app.alert(1))>>'],
    ['OpenAction', '%PDF-1.4 <</OpenAction 5 0 R>>'],
    ['Launch', '%PDF-1.4 <</S/Launch/F(cmd.exe)>>'],
    ['EmbeddedFile', '%PDF-1.4 <</Type/EmbeddedFile>>'],
  ])('detecta %s', (name, pdf) => {
    expect(pdfActiveContent(Buffer.from(pdf))).toBeDefined();
    expect(name).toBeTruthy();
  });

  it('detecta nombres escondidos con #xx', () => {
    expect(pdfActiveContent(Buffer.from('%PDF-1.4 <</S/J#61vaScript>>'))).toBe(
      'JavaScript',
    );
  });
});

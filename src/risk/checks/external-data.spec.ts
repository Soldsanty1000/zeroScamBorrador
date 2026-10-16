import { cleanText, readJsonLimited } from './external-data';

describe('cleanText', () => {
  it('deja un texto normal tal cual', () => {
    expect(cleanText("Let's Encrypt")).toBe("Let's Encrypt");
    expect(cleanText('Banco Nacional de México, S.A.')).toBe(
      'Banco Nacional de México, S.A.',
    );
  });

  it('quita caracteres de control y convierte saltos de línea en espacio', () => {
    expect(cleanText('Emisor\u0000\u0007 Falso\r\nOtra línea\tfin')).toBe(
      'Emisor Falso Otra línea fin',
    );
  });

  it('quita los caracteres bidireccionales que invierten el texto', () => {
    // U+202E (RLO) haría que lo que sigue se lea al revés.
    expect(cleanText('Emisor ‮oof‬ ⁦x⁩')).toBe('Emisor oof x');
  });

  it('quita los invisibles: ancho cero, BOM, relleno hangul, braille en blanco', () => {
    expect(cleanText('pay​pal‍﻿⁠­')).toBe('paypal');
    expect(cleanText('aㅤbᅟc⠀d')).toBe('abcd');
    // Caracteres de etiqueta (U+E0000..), invisibles y de la categoría Cf.
    expect(cleanText('a\u{E0041}b')).toBe('ab');
  });

  it('quita < y > para que no se cuelen como HTML', () => {
    expect(cleanText('<script>alert(1)</script>')).toBe(
      'scriptalert(1)/script',
    );
  });

  it('colapsa los espacios y recorta los extremos', () => {
    expect(cleanText('   a    b    c   ')).toBe('a b c');
  });

  it('recorta a max caracteres con una elipsis', () => {
    const result = cleanText('A'.repeat(200));
    expect(Array.from(result)).toHaveLength(64);
    expect(result.endsWith('…')).toBe(true);
    expect(cleanText('B'.repeat(10), 5)).toBe('BBBB…');
  });

  it('no parte un emoji a la mitad al recortar', () => {
    const result = cleanText('😀'.repeat(100), 10);
    expect(Array.from(result)).toHaveLength(10);
    expect(result).toBe('😀'.repeat(9) + '…');
  });

  it('une un campo repetido y tolera lo que no es texto', () => {
    expect(cleanText(['Uno', 'Dos'])).toBe('Uno, Dos');
    expect(cleanText(undefined)).toBe('');
    expect(cleanText(null)).toBe('');
    expect(cleanText(42)).toBe('42');
    expect(cleanText('​‮')).toBe('');
  });
});

/** Una respuesta con el cuerpo repartido en los fragmentos indicados. */
function streamed(chunks: string[], headers?: Record<string, string>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers });
}

describe('readJsonLimited', () => {
  it('lee un JSON que llega en varios fragmentos', async () => {
    const response = streamed(['{"eventos":', '[1,2,', '3]}']);
    await expect(readJsonLimited(response, 1024)).resolves.toEqual({
      eventos: [1, 2, 3],
    });
  });

  it('rechaza un cuerpo que pasa del tope aunque no avise su tamaño', async () => {
    const response = streamed(['{"x":"', 'a'.repeat(600), '"}']);
    await expect(readJsonLimited(response, 512)).rejects.toThrow(
      'demasiado grande',
    );
  });

  it('cancela la lectura al rebasar el tope', async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      // Un servidor que nunca termina de mandar.
      pull(controller) {
        controller.enqueue(encoder.encode('a'.repeat(100)));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readJsonLimited(new Response(body), 1000)).rejects.toThrow(
      'demasiado grande',
    );
    expect(cancelled).toBe(true);
  });

  it('rechaza sin leer si el encabezado ya dice que es muy grande', async () => {
    const response = streamed(['{}'], { 'content-length': '999999' });
    await expect(readJsonLimited(response, 1024)).rejects.toThrow(
      'demasiado grande',
    );
  });

  it('rechaza un cuerpo que no es JSON', async () => {
    await expect(readJsonLimited(streamed(['<html>']), 1024)).rejects.toThrow();
  });

  it('rechaza una respuesta sin cuerpo', async () => {
    await expect(
      readJsonLimited(new Response(null, { status: 204 }), 1024),
    ).rejects.toThrow('no trae cuerpo');
  });
});

import type { Target } from '../target';
import { blacklistResult, checkBlacklist } from './blacklist.check';

const TARGET: Target = {
  url: 'https://ejemplo.com/',
  hostname: 'ejemplo.com',
  protocol: 'https',
  port: 443,
  address: '93.184.216.34',
};

describe('blacklistResult', () => {
  it('pasa una URL que no está en la lista', () => {
    const result = blacklistResult([]);
    expect(result.passed).toBe(true);
    expect(result.points).toBe(0);
    expect(result.minLevel).toBeUndefined();
  });

  it('marca MUY_ALTO una URL registrada como phishing', () => {
    const result = blacklistResult(['SOCIAL_ENGINEERING']);
    expect(result.passed).toBe(false);
    expect(result.points).toBe(100);
    expect(result.minLevel).toBe('MUY_ALTO');
    expect(result.detail).toContain('phishing');
  });

  it('no repite una amenaza que llega varias veces', () => {
    const result = blacklistResult([
      'MALWARE',
      'MALWARE',
      'SOCIAL_ENGINEERING',
    ]);
    expect(result.detail).toContain('malware, phishing');
  });

  it('no da puntos ni pasa si no se pudo consultar: queda sin verificar', () => {
    const result = blacklistResult(undefined);
    expect(result.passed).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.points).toBe(0);
    expect(result.minLevel).toBeUndefined();
  });

  it('una consulta hecha cuenta como verificada, esté limpia o no', () => {
    expect(blacklistResult([]).verified).not.toBe(false);
    expect(blacklistResult(['MALWARE']).verified).not.toBe(false);
  });
});

describe('checkBlacklist', () => {
  const saved = process.env.SAFE_BROWSING_API_KEY;

  afterEach(() => {
    if (saved === undefined) delete process.env.SAFE_BROWSING_API_KEY;
    else process.env.SAFE_BROWSING_API_KEY = saved;
  });

  it('no consulta nada si falta la llave: queda sin verificar', async () => {
    delete process.env.SAFE_BROWSING_API_KEY;
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const result = await checkBlacklist(TARGET);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      name: 'blacklist',
      passed: false,
      verified: false,
      points: 0,
      detail: 'Lista negra no configurada',
    });
    fetchMock.mockRestore();
  });

  describe('con llave', () => {
    let fetchMock: jest.SpiedFunction<typeof fetch>;

    beforeEach(() => {
      process.env.SAFE_BROWSING_API_KEY = 'llave-de-prueba';
      fetchMock = jest.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchMock.mockRestore();
    });

    it('manda a Google solo la URL normalizada, sin la llave en la URL', async () => {
      fetchMock.mockResolvedValueOnce(new Response('{}'));
      // `Target.url` ya viene sin consulta, fragmento ni usuario.
      await checkBlacklist({ ...TARGET, url: 'https://ejemplo.com/login' });

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain('llave-de-prueba');
      const body = JSON.parse(options.body as string) as {
        threatInfo: { threatEntries: unknown };
      };
      expect(body.threatInfo.threatEntries).toEqual([
        { url: 'https://ejemplo.com/login' },
      ]);
      expect(options.redirect).toBe('error');
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('pasa una URL que Google no tiene registrada', async () => {
      fetchMock.mockResolvedValueOnce(new Response('{}'));
      expect(await checkBlacklist(TARGET)).toMatchObject({
        passed: true,
        points: 0,
      });
    });

    it('marca MUY_ALTO una URL que Google tiene registrada', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ matches: [{ threatType: 'SOCIAL_ENGINEERING' }] }),
        ),
      );
      const result = await checkBlacklist(TARGET);
      expect(result).toMatchObject({
        passed: false,
        points: 100,
        minLevel: 'MUY_ALTO',
      });
      expect(result.verified).not.toBe(false);
    });

    it.each([
      ['Google no contesta', () => Promise.reject(new Error('timeout'))],
      [
        'Google rechaza la llave',
        () => Promise.resolve(new Response('{}', { status: 403 })),
      ],
      [
        'Google está saturado',
        () => Promise.resolve(new Response('{}', { status: 429 })),
      ],
      [
        'la respuesta no es JSON',
        () => Promise.resolve(new Response('<html>')),
      ],
      [
        'la respuesta es enorme',
        () =>
          Promise.resolve(new Response('{"matches":[]}' + ' '.repeat(200_000))),
      ],
    ])('queda sin verificar si %s', async (_caso, answer) => {
      fetchMock.mockImplementationOnce(answer);
      expect(await checkBlacklist(TARGET)).toMatchObject({
        name: 'blacklist',
        passed: false,
        verified: false,
        points: 0,
        detail: 'No se pudo consultar la lista negra',
      });
    });
  });
});

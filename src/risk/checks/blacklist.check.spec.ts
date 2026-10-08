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

  it('no da puntos si no se pudo consultar', () => {
    const result = blacklistResult(undefined);
    expect(result.passed).toBe(true);
    expect(result.points).toBe(0);
  });
});

describe('checkBlacklist', () => {
  const saved = process.env.SAFE_BROWSING_API_KEY;

  afterEach(() => {
    if (saved === undefined) delete process.env.SAFE_BROWSING_API_KEY;
    else process.env.SAFE_BROWSING_API_KEY = saved;
  });

  it('no consulta nada si falta la llave', async () => {
    delete process.env.SAFE_BROWSING_API_KEY;
    const result = await checkBlacklist(TARGET);
    expect(result).toMatchObject({
      name: 'blacklist',
      passed: true,
      points: 0,
      detail: 'Lista negra no configurada',
    });
  });
});

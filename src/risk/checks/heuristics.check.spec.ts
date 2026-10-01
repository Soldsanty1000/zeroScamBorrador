import type { Target } from '../target';
import { checkHeuristics } from './heuristics.check';

/** Arma un `Target` como el que regresa `resolveTarget`, sin tocar el DNS. */
function target(raw: string): Target {
  const url = new URL(raw);
  return {
    url: url.toString(),
    hostname: url.hostname.replace(/^\[|\]$/g, ''),
    protocol: url.protocol === 'https:' ? 'https' : 'http',
    port: url.protocol === 'https:' ? 443 : 80,
    address: '93.184.216.34',
  };
}

describe('checkHeuristics', () => {
  it('pasa una URL normal', () => {
    const result = checkHeuristics(target('https://www.ejemplo.com/tienda'));
    expect(result.passed).toBe(true);
    expect(result.points).toBe(0);
  });

  it('no marca el dominio oficial de una marca', () => {
    expect(checkHeuristics(target('https://www.bbva.mx/')).passed).toBe(true);
    expect(checkHeuristics(target('https://www.paypal.com/mx')).passed).toBe(
      true,
    );
  });

  it('detecta una marca con números en vez de letras', () => {
    const result = checkHeuristics(target('https://paypa1.com/login'));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('paypal');
  });

  it('detecta una marca con un error de dedo', () => {
    const result = checkHeuristics(target('https://mercadolibrre.com/'));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('mercadolibre');
  });

  it('detecta una marca dentro de otro dominio', () => {
    const result = checkHeuristics(target('https://bbva-seguro.login.com/'));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('bbva');
  });

  it('detecta una IP como host', () => {
    const result = checkHeuristics(target('http://93.184.216.34/banco'));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('dirección IP');
  });

  it('detecta un @ que esconde el dominio', () => {
    const result = checkHeuristics(target('https://banco.com@ejemplo.net/'));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('@');
  });

  it('detecta caracteres que imitan letras (punycode)', () => {
    const result = checkHeuristics(target('https://bancó.mx/'));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('caracteres especiales');
  });

  it('suma las señales sin pasar de 100', () => {
    const result = checkHeuristics(
      target('http://usuario@paypa1.a.b.c.xn--banc-tqa.mx/'),
    );
    expect(result.points).toBeGreaterThan(50);
    expect(result.points).toBeLessThanOrEqual(100);
  });
});

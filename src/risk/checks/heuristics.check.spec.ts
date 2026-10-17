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

  it('detecta un sitio que aparenta ser de gobierno', () => {
    const result = checkHeuristics(target('https://sat-gob-mx.com/'));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('gobierno');
    expect(result.detail).toContain('"sat"');
    expect(checkHeuristics(target('https://www.sat.gob.mx/')).passed).toBe(
      true,
    );
  });

  it('lee "rn" como "m" en marcas cortas', () => {
    const result = checkHeuristics(target('https://arnazon.com.mx/'));
    expect(result.detail).toContain('amazon');
  });

  it('no marca la infraestructura ni los dominios de otra marca oficial', () => {
    for (const url of [
      'https://cloud.microsoft/',
      'https://www.bancoppel.com/',
      'https://www.google.de/',
      'https://www.amazon.co.uk/',
    ]) {
      expect(checkHeuristics(target(url)).passed).toBe(true);
    }
  });

  it('no deduce dominios por país del nombre de la marca', () => {
    expect(checkHeuristics(target('https://paypal.tk/')).detail).toContain(
      'paypal',
    );
    expect(checkHeuristics(target('https://paypal.com.co/')).detail).toContain(
      'paypal',
    );
  });

  it('analiza el subdominio del cliente en un hosting compartido', () => {
    const bucket = checkHeuristics(
      target('https://bbva-seguridad.s3.amazonaws.com/'),
    );
    expect(bucket.detail).toContain('bbva');
    expect(bucket.detail).toContain('hosting');
    expect(
      checkHeuristics(target('https://s3.amazonaws.com/')).detail,
    ).not.toContain('amazon"');
  });

  it('no castiga un dominio internacional escrito en su alfabeto', () => {
    // пример.рф ("ejemplo" en ruso)
    const result = checkHeuristics(target('https://xn--e1afmkfd.xn--p1ai/'));
    expect(result.passed).toBe(true);
  });

  it('detecta letras cirílicas que se leen como una marca', () => {
    // аррӏе.com: todo cirílico, se lee "apple"
    const result = checkHeuristics(target('https://xn--80ak6aa92e.com/'));
    expect(result.detail).toContain('apple');
  });

  it('palabras de anzuelo y terminaciones abusadas suman poco por sí solas', () => {
    const result = checkHeuristics(target('https://cfe-pagos.online/'));
    expect(result.detail).toContain('anzuelo');
    expect(result.detail).toContain('.online');
    const plain = checkHeuristics(target('https://mi-tienda.online/'));
    expect(plain.points).toBeLessThan(25);
  });

  it('suma las señales sin pasar de 100', () => {
    const result = checkHeuristics(
      target('http://usuario@paypa1.a.b.c.xn--banc-tqa.mx/'),
    );
    expect(result.points).toBeGreaterThan(50);
    expect(result.points).toBeLessThanOrEqual(100);
  });
});

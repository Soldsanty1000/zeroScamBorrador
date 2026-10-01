import {
  ageResult,
  parseWhoisDate,
  registrableDomain,
} from './domain-age.check';

const NOW = new Date('2026-10-01T00:00:00.000Z');

describe('parseWhoisDate', () => {
  it('lee la fecha de una respuesta de NIC México', () => {
    const text =
      '\nDomain Name:       bbva.mx\n\n' +
      'Created On:        2009-05-04\n' +
      'Expiration Date:   2028-05-03\n' +
      'Last Updated On:   2026-09-26\n';
    expect(parseWhoisDate(text)).toEqual(new Date('2009-05-04'));
  });

  it('no regresa fecha si el dominio no existe', () => {
    const text = '\nNo_Se_Encontro_El_Objeto/Object_Not_Found\n';
    expect(parseWhoisDate(text)).toBeUndefined();
  });
});

describe('registrableDomain', () => {
  it('quita los subdominios', () => {
    expect(registrableDomain('www.tienda.ejemplo.com')).toBe('ejemplo.com');
    expect(registrableDomain('ejemplo.com')).toBe('ejemplo.com');
  });

  it('conserva el segundo nivel de los dominios de país', () => {
    expect(registrableDomain('login.banco.com.mx')).toBe('banco.com.mx');
    expect(registrableDomain('www.sat.gob.mx')).toBe('sat.gob.mx');
    expect(registrableDomain('www.bbva.mx')).toBe('bbva.mx');
  });
});

describe('ageResult', () => {
  it('marca un dominio de menos de 30 días', () => {
    const result = ageResult(new Date('2026-09-26'), 'malo.com', NOW);
    expect(result.passed).toBe(false);
    expect(result.points).toBe(30);
    expect(result.detail).toContain('5 días');
  });

  it('marca un dominio de menos de 180 días', () => {
    const result = ageResult(new Date('2026-06-01'), 'nuevo.com', NOW);
    expect(result.passed).toBe(false);
    expect(result.points).toBe(15);
  });

  it('pasa un dominio antiguo', () => {
    const result = ageResult(new Date('1997-09-15'), 'google.com', NOW);
    expect(result.passed).toBe(true);
    expect(result.points).toBe(0);
    expect(result.detail).toContain('29 años');
  });

  it('no da puntos si no se sabe la fecha', () => {
    const result = ageResult(undefined, 'No se pudo consultar', NOW);
    expect(result.passed).toBe(true);
    expect(result.points).toBe(0);
  });
});

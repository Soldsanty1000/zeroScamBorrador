import { lookup } from 'node:dns/promises';
import type { Target } from '../target';
import {
  ageResult,
  checkDomainAge,
  parseWhoisDate,
  registrableDomain,
} from './domain-age.check';

// Ninguna prueba toca la red: `fetch` y el DNS se simulan.
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
const lookupMock = jest.mocked(lookup) as unknown as jest.Mock;

const NOW = new Date('2026-10-01T00:00:00.000Z');

const TARGET: Target = {
  url: 'https://www.ejemplo.com/',
  hostname: 'www.ejemplo.com',
  protocol: 'https',
  port: 443,
  address: '93.184.216.34',
};

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

  it('no da puntos ni pasa si no se sabe la fecha: queda sin verificar', () => {
    const result = ageResult(undefined, 'No se pudo consultar', NOW);
    expect(result.passed).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.points).toBe(0);
  });

  it('una fecha conocida sí cuenta como verificada', () => {
    expect(
      ageResult(new Date('1997-09-15'), 'google.com', NOW).verified,
    ).not.toBe(false);
  });
});

/** Un cuerpo RDAP con la fecha de registro. */
function rdap(date: string) {
  return JSON.stringify({
    events: [
      { eventAction: 'last changed', eventDate: '2026-09-01T00:00:00Z' },
      { eventAction: 'registration', eventDate: date },
    ],
  });
}

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

describe('checkDomainAge (RDAP)', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  /** La URL a la que se hizo la llamada número `call` a `fetch`. */
  function requested(call: number): string {
    const input = fetchMock.mock.calls[call][0];
    return input instanceof URL ? input.href : (input as string);
  }

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    lookupMock.mockReset();
    // Por omisión, todo nombre resuelve a una IP pública.
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('lee la fecha de registro y consulta el dominio registrable', async () => {
    fetchMock.mockResolvedValueOnce(new Response(rdap('2020-01-01T00:00:00Z')));
    const result = await checkDomainAge(TARGET);

    expect(requested(0)).toBe('https://rdap.org/domain/ejemplo.com');
    expect(result.passed).toBe(true);
    expect(result.verified).not.toBe(false);
    expect(result.detail).toContain('ejemplo.com se registró hace');
  });

  it('no deja que fetch siga redirecciones y le pone un plazo total', async () => {
    fetchMock.mockResolvedValueOnce(new Response(rdap('2020-01-01T00:00:00Z')));
    await checkDomainAge(TARGET);

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(options.redirect).toBe('manual');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('sigue la redirección de rdap.org al registro (HTTPS, host público)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        redirect('https://rdap.verisign.com/com/v1/domain/ejemplo.com'),
      )
      .mockResolvedValueOnce(new Response(rdap('2026-09-25T00:00:00Z')));
    const result = await checkDomainAge(TARGET);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requested(1)).toBe(
      'https://rdap.verisign.com/com/v1/domain/ejemplo.com',
    );
    expect(lookupMock).toHaveBeenCalledWith('rdap.verisign.com', { all: true });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('es muy nuevo');
  });

  it('resuelve una redirección relativa contra la URL anterior', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('/otro/camino', 301))
      .mockResolvedValueOnce(new Response(rdap('2020-01-01T00:00:00Z')));
    await checkDomainAge(TARGET);
    expect(requested(1)).toBe('https://rdap.org/otro/camino');
  });

  it.each([
    ['http://rdap.registro.com/domain/ejemplo.com', 'no es HTTPS'],
    ['https://127.0.0.1/domain/ejemplo.com', 'es una IP'],
    ['https://169.254.169.254/latest/meta-data/', 'es una IP interna'],
    ['https://[::1]/domain/ejemplo.com', 'es una IPv6'],
    ['https://usuario:clave@rdap.registro.com/x', 'trae credenciales'],
    ['https://rdap.registro.com:8443/x', 'usa otro puerto'],
  ])('no sigue una redirección que %s', async (location) => {
    fetchMock.mockResolvedValueOnce(redirect(location));
    const result = await checkDomainAge(TARGET);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ passed: false, verified: false, points: 0 });
  });

  it('no sigue una redirección a un nombre que resuelve a una IP interna', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    fetchMock.mockResolvedValueOnce(
      redirect('https://rdap.interno.example/domain/ejemplo.com'),
    );
    const result = await checkDomainAge(TARGET);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.verified).toBe(false);
  });

  it('se rinde después de varias redirecciones seguidas', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(redirect('https://rdap.registro.com/vuelta')),
    );
    const result = await checkDomainAge(TARGET);

    // La consulta inicial más 3 redirecciones seguidas.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.verified).toBe(false);
  });

  it('queda sin verificar si la redirección no trae destino', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    const result = await checkDomainAge(TARGET);
    expect(result.verified).toBe(false);
  });

  it('no lee un cuerpo más grande que el tope', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(rdap('2020-01-01T00:00:00Z') + ' '.repeat(300 * 1024)),
    );
    const result = await checkDomainAge(TARGET);
    expect(result).toMatchObject({ passed: false, verified: false });
  });

  it('queda sin verificar si el registro no conoce el dominio', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 404 }));
    expect(await checkDomainAge(TARGET)).toMatchObject({
      passed: false,
      verified: false,
      points: 0,
    });
  });

  it('queda sin verificar si el registro no contesta o contesta basura', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('plazo', 'TimeoutError'));
    expect((await checkDomainAge(TARGET)).verified).toBe(false);

    fetchMock.mockResolvedValueOnce(new Response('<html>'));
    expect((await checkDomainAge(TARGET)).verified).toBe(false);

    fetchMock.mockResolvedValueOnce(new Response('{"events":[]}'));
    expect((await checkDomainAge(TARGET)).verified).toBe(false);
  });

  it('una IP no tiene fecha de registro: no aplica, y no se consulta nada', async () => {
    const result = await checkDomainAge({
      ...TARGET,
      hostname: '93.184.216.34',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ passed: true, points: 0 });
    expect(result.verified).not.toBe(false);
  });
});

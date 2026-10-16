import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isPublicHost, normalizeUrl, resolveTarget } from './target';

// Ninguna prueba toca la red: el DNS se simula.
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
const lookupMock = jest.mocked(lookup) as unknown as jest.Mock;

/** Lo que regresa `dns.lookup(host, { all: true })`. */
function answer(...addresses: string[]) {
  return addresses.map((address) => ({
    address,
    family: address.includes(':') ? 6 : 4,
  }));
}

const INTERNAL = 'url apunta a una dirección interna y no se puede analizar';

describe('normalizeUrl', () => {
  it('deja solo esquema, host, puerto y ruta', () => {
    const result = normalizeUrl(
      'https://Banco.COM/login/paso1?token=abc123&correo=a@b.com#seccion',
    );
    expect(result.url).toBe('https://banco.com/login/paso1');
    expect(result.hostname).toBe('banco.com');
  });

  it('quita el usuario y la clave, pero avisa que los traía', () => {
    const result = normalizeUrl('https://usuario:secreto@ejemplo.com/ruta');
    expect(result.url).toBe('https://ejemplo.com/ruta');
    expect(result.url).not.toContain('secreto');
    expect(result.hasUserInfo).toBe(true);
    expect(normalizeUrl('https://ejemplo.com/').hasUserInfo).toBe(false);
  });

  it('conserva un puerto permitido y quita un "?" o "#" vacío', () => {
    expect(normalizeUrl('http://ejemplo.com:80/a?#').url).toBe(
      'http://ejemplo.com/a',
    );
    expect(normalizeUrl('https://ejemplo.com:443/a?').url).toBe(
      'https://ejemplo.com/a',
    );
  });

  it('da la misma llave a enlaces que solo cambian la consulta', () => {
    expect(normalizeUrl('https://ejemplo.com/a?u=1').url).toBe(
      normalizeUrl('https://EJEMPLO.com/a?u=2#x').url,
    );
  });

  it('es idempotente', () => {
    const once = normalizeUrl('https://u:p@ejemplo.com/a?b=c#d').url;
    expect(normalizeUrl(once).url).toBe(once);
  });

  it('rechaza lo que no es http/https o usa otro puerto', () => {
    expect(() => normalizeUrl('ftp://ejemplo.com/')).toThrow(
      'url debe ser http o https',
    );
    expect(() => normalizeUrl('https://ejemplo.com:3306/')).toThrow(
      'Solo se analizan los puertos 80 y 443',
    );
    expect(() => normalizeUrl('no es una url')).toThrow(
      'url no es una URL válida',
    );
  });
});

describe('resolveTarget: direcciones internas', () => {
  // Un ejemplo de cada rango bloqueado, en los extremos y en medio.
  const IPV4 = [
    '0.0.0.1', // 0.0.0.0/8
    '10.1.2.3', // 10.0.0.0/8
    '100.64.0.1', // 100.64.0.0/10 (CGNAT)
    '100.127.255.254',
    '127.0.0.1', // loopback
    '169.254.169.254', // link-local: metadatos de la nube
    '172.16.0.1', // 172.16.0.0/12
    '172.31.255.254',
    '192.0.0.8', // 192.0.0.0/24
    '192.0.2.10', // 192.0.2.0/24 (documentación)
    '192.88.99.1', // relevo 6to4
    '192.168.1.1', // 192.168.0.0/16
    '198.18.0.1', // 198.18.0.0/15
    '198.19.255.255',
    '198.51.100.5', // 198.51.100.0/24
    '203.0.113.9', // 203.0.113.0/24
    '224.0.0.1', // multicast
    '239.255.255.250',
    '240.0.0.1', // reservado
    '255.255.255.255',
  ];
  const IPV6 = [
    '::1', // loopback
    '::', // no especificada
    '::7f00:1', // IPv4-compatible (obsoleta) de 127.0.0.1
    'fc00::1', // única local
    'fd12:3456::1',
    'fe80::1', // link-local
    'fec0::1', // site-local
    'ff02::1', // multicast
    '64:ff9b::808:808', // NAT64 (8.8.8.8)
    '64:ff9b::7f00:1', // NAT64 hacia 127.0.0.1
    '64:ff9b:1::1', // NAT64 de uso local
    '2002:808:808::1', // 6to4
    '2002:7f00:1::', // 6to4 hacia 127.0.0.1
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
    '2001:db8::1', // documentación
    '100::1', // descarte
    '::ffff:0:a00:1', // IPv4 traducida (SIIT)
  ];
  // Las dos formas de escribir una IPv4 mapeada: con puntos y hexadecimal
  // (`new URL` serializa siempre la hexadecimal).
  const MAPPED = [
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:192.168.1.1',
    '0:0:0:0:0:ffff:c0a8:101',
    '::ffff:0.0.0.0',
    '::ffff:100.64.0.1',
    '::ffff:6440:1',
    '::ffff:255.255.255.255',
  ];

  it.each(IPV4)('rechaza la IPv4 %s', async (address) => {
    await expect(resolveTarget(`http://${address}/`)).rejects.toThrow(INTERNAL);
  });

  it.each(IPV6)('rechaza la IPv6 %s', async (address) => {
    await expect(resolveTarget(`http://[${address}]/`)).rejects.toThrow(
      INTERNAL,
    );
  });

  it.each(MAPPED)('rechaza la IPv4 mapeada %s', async (address) => {
    await expect(resolveTarget(`https://[${address}]/`)).rejects.toThrow(
      INTERNAL,
    );
  });

  it('rechaza con BadRequestException (400)', async () => {
    await expect(resolveTarget('http://127.0.0.1/')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rechaza un host cuyo DNS contesta una dirección interna', async () => {
    for (const address of [
      '127.0.0.1',
      '64:ff9b::808:808',
      '2002:808:808::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
    ]) {
      lookupMock.mockResolvedValueOnce(answer(address));
      await expect(resolveTarget('http://malo.ejemplo.com/')).rejects.toThrow(
        INTERNAL,
      );
    }
  });

  it('rechaza si basta una dirección interna entre varias', async () => {
    lookupMock.mockResolvedValueOnce(answer('93.184.216.34', '10.0.0.5'));
    await expect(resolveTarget('http://mixto.ejemplo.com/')).rejects.toThrow(
      INTERNAL,
    );
  });
});

describe('resolveTarget: direcciones públicas', () => {
  // Justo afuera de cada rango bloqueado.
  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.0.1.1',
    '198.17.255.255',
    '198.20.0.1',
    '203.0.114.1',
    '223.255.255.254',
  ])('deja pasar la IPv4 %s', async (address) => {
    const target = await resolveTarget(`http://${address}/`);
    expect(target.address).toBe(address);
  });

  it('deja pasar una IPv6 pública', async () => {
    const target = await resolveTarget('https://[2606:4700:4700::1111]/');
    expect(target.address).toBe('2606:4700:4700::1111');
  });

  it('trata una IPv4 mapeada pública como la IPv4', async () => {
    const hex = await resolveTarget('https://[::ffff:808:808]/');
    expect(hex.address).toBe('8.8.8.8');
    const dotted = await resolveTarget('https://[::ffff:8.8.8.8]/');
    expect(dotted.address).toBe('8.8.8.8');
  });

  it('usa la primera dirección pública del DNS', async () => {
    lookupMock.mockResolvedValueOnce(answer('93.184.216.34'));
    const target = await resolveTarget('https://ejemplo.com/a?x=1#y');
    expect(target).toMatchObject({
      url: 'https://ejemplo.com/a',
      hostname: 'ejemplo.com',
      address: '93.184.216.34',
    });
  });

  it('regresa sin dirección si el dominio no resuelve', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const target = await resolveTarget('https://no-existe.ejemplo.com/');
    expect(target.address).toBeUndefined();
  });
});

describe('isPublicHost', () => {
  it('acepta un host que resuelve a una IP pública', async () => {
    lookupMock.mockResolvedValueOnce(answer('93.184.216.34'));
    await expect(isPublicHost('rdap.ejemplo.com')).resolves.toBe(true);
  });

  it('rechaza un host interno, uno que no resuelve y una IP interna', async () => {
    lookupMock.mockResolvedValueOnce(answer('192.168.0.10'));
    await expect(isPublicHost('interno.ejemplo.com')).resolves.toBe(false);
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(isPublicHost('no-existe.ejemplo.com')).resolves.toBe(false);
    await expect(isPublicHost('127.0.0.1')).resolves.toBe(false);
  });
});

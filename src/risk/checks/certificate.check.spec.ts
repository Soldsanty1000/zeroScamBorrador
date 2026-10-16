import { EventEmitter } from 'node:events';
import { connect } from 'node:tls';
import type { Target } from '../target';
import { checkCertificate } from './certificate.check';

// Ninguna prueba abre un socket de verdad: `connect` regresa un socket falso
// que las pruebas manejan a mano.
jest.mock('node:tls', () => ({ connect: jest.fn() }));
const connectMock = jest.mocked(connect) as unknown as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-01T00:00:00.000Z');

const TARGET: Target = {
  url: 'https://ejemplo.com/',
  hostname: 'ejemplo.com',
  protocol: 'https',
  port: 443,
  address: '93.184.216.34',
};

/** Un socket TLS falso: solo lo que usa `fetchCertificate`. */
class FakeSocket extends EventEmitter {
  authorized = true;
  authorizationError: unknown = undefined;
  destroyed = false;
  certificate: Record<string, unknown> = {};
  // Como el real: destruir con un error emite 'error' y luego 'close'.
  destroy = jest.fn((error?: Error) => {
    if (this.destroyed) return;
    this.destroyed = true;
    if (error) this.emit('error', error);
    this.emit('close');
    return this;
  });
  end = jest.fn();
  getPeerCertificate() {
    return this.certificate;
  }
}

function certificate(
  issuer: Record<string, unknown>,
  fromDaysAgo = 90,
  toDaysAhead = 200,
) {
  return {
    issuer,
    valid_from: new Date(NOW.getTime() - fromDaysAgo * DAY).toUTCString(),
    valid_to: new Date(NOW.getTime() + toDaysAhead * DAY).toUTCString(),
  };
}

describe('checkCertificate', () => {
  let socket: FakeSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    socket = new FakeSocket();
    connectMock.mockReset().mockReturnValue(socket);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('no se conecta si el dominio no resuelve: queda sin verificar', async () => {
    const result = await checkCertificate({ ...TARGET, address: undefined });
    expect(connectMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'INACCESIBLE',
      passed: false,
      verified: false,
      points: 0,
    });
  });

  it('un sitio http es un hallazgo (INSEGURO), no una verificación fallida', async () => {
    const result = await checkCertificate({
      ...TARGET,
      protocol: 'http',
      port: 80,
    });
    expect(connectMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'INSEGURO', points: 20 });
    expect(result.verified).toBe(true);
  });

  it('lee un certificado válido y destruye el socket', async () => {
    const pending = checkCertificate(TARGET);
    socket.certificate = certificate({ O: 'Let’s Encrypt' });
    socket.emit('secureConnect');
    const result = await pending;

    expect(result).toMatchObject({
      status: 'VALIDO',
      passed: true,
      verified: true,
      points: 0,
    });
    expect(result.detail).toContain('Certificado de Let’s Encrypt');
    expect(result.detail).toContain('emitido hace 90 días');
    // Se conecta a la IP ya revisada, con el nombre aparte (SNI).
    expect(connectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '93.184.216.34',
        servername: 'ejemplo.com',
        timeout: 2000,
      }),
    );
    // `destroy` y no `end`: `end` deja el socket abierto hasta que el
    // servidor quiera cerrar el suyo.
    expect(socket.destroy).toHaveBeenCalled();
    expect(socket.end).not.toHaveBeenCalled();
  });

  it('no deja temporizadores vivos al terminar bien', async () => {
    const pending = checkCertificate(TARGET);
    expect(jest.getTimerCount()).toBe(1);
    socket.certificate = certificate({ O: 'Emisor' });
    socket.emit('secureConnect');
    await pending;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('corta la conexión aunque el servidor siga mandando bytes', async () => {
    const pending = checkCertificate(TARGET);
    // Un servidor que gotea un byte por segundo: el socket nunca está
    // inactivo 2 s, así que su 'timeout' no salta. Solo el temporizador de
    // duración total lo frena.
    for (let second = 0; second < 2; second++) {
      jest.advanceTimersByTime(1000);
      socket.emit('data', Buffer.from('x'));
    }
    expect(socket.destroy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    const result = await pending;

    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(socket.destroy).toHaveBeenCalledWith(new Error('timeout'));
    expect(result).toMatchObject({
      status: 'INACCESIBLE',
      verified: false,
      passed: false,
      points: 0,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('destruye el socket cuando salta el timeout de inactividad', async () => {
    const pending = checkCertificate(TARGET);
    socket.emit('timeout');
    const result = await pending;
    expect(socket.destroy).toHaveBeenCalled();
    expect(result.verified).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('queda sin verificar si el servidor corta o falla antes del certificado', async () => {
    let pending = checkCertificate(TARGET);
    socket.emit('error', new Error('ECONNRESET'));
    await expect(pending).resolves.toMatchObject({
      status: 'INACCESIBLE',
      verified: false,
    });

    socket = new FakeSocket();
    connectMock.mockReturnValue(socket);
    pending = checkCertificate(TARGET);
    socket.emit('close');
    await expect(pending).resolves.toMatchObject({ verified: false });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('queda sin verificar si connect lanza', async () => {
    connectMock.mockImplementation(() => {
      throw new Error('EMFILE');
    });
    await expect(checkCertificate(TARGET)).resolves.toMatchObject({
      status: 'INACCESIBLE',
      verified: false,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('queda sin verificar si el sitio no presenta un certificado legible', async () => {
    const pending = checkCertificate(TARGET);
    socket.certificate = {};
    socket.emit('secureConnect');
    await expect(pending).resolves.toMatchObject({
      status: 'INACCESIBLE',
      verified: false,
      points: 0,
    });
  });

  it('marca EXPIRADO un certificado vencido', async () => {
    const pending = checkCertificate(TARGET);
    socket.certificate = certificate({ O: 'Emisor' }, 400, -10);
    socket.emit('secureConnect');
    const result = await pending;
    expect(result).toMatchObject({
      status: 'EXPIRADO',
      passed: false,
      verified: true,
      points: 40,
    });
    expect(result.detail).toContain('venció hace 10 días');
  });

  it('limpia el emisor: sin control, bidi ni invisibles, y recortado a 64', async () => {
    const pending = checkCertificate(TARGET);
    socket.certificate = certificate({
      O: 'Banco‮ Seguro​\u0000\nS.A. ' + 'X'.repeat(300),
    });
    socket.emit('secureConnect');
    const result = await pending;

    // Ni controles ni invisibles (`\p{C}` incluye los bidi y el ancho cero).
    expect(/\p{C}/u.test(result.detail)).toBe(false);
    const issuer = /^Certificado de (.*), emitido/.exec(result.detail)?.[1];
    expect(issuer).toBeDefined();
    expect(Array.from(issuer!).length).toBeLessThanOrEqual(64);
    expect(issuer!.startsWith('Banco Seguro S.A. XXX')).toBe(true);
  });

  it('usa el CN si no hay O, y un nombre fijo si no hay nada visible', async () => {
    let pending = checkCertificate(TARGET);
    socket.certificate = certificate({ CN: ['Uno', 'Dos'] });
    socket.emit('secureConnect');
    expect((await pending).detail).toContain('Certificado de Uno, Dos,');

    socket = new FakeSocket();
    connectMock.mockReturnValue(socket);
    pending = checkCertificate(TARGET);
    socket.certificate = certificate({ O: '​‮' });
    socket.emit('secureConnect');
    expect((await pending).detail).toContain(
      'Certificado de emisor desconocido',
    );
  });

  it('no repite en el detalle el mensaje largo que escribió el certificado', async () => {
    const pending = checkCertificate(TARGET);
    socket.certificate = certificate({ O: 'Emisor' });
    socket.authorized = false;
    // Node arma este mensaje con los nombres que trae el certificado.
    socket.authorizationError = Object.assign(
      new Error('Hostname/IP does not match... DNS:' + 'a.com,'.repeat(200)),
      { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
    );
    socket.emit('secureConnect');
    const result = await pending;

    expect(result).toMatchObject({ status: 'INSEGURO', points: 35 });
    expect(result.detail).toBe(
      'El certificado no es de confianza (ERR_TLS_CERT_ALTNAME_INVALID)',
    );
  });

  it('limpia y recorta un error de confianza que no trae código', async () => {
    const pending = checkCertificate(TARGET);
    socket.certificate = certificate({ O: 'Emisor' });
    socket.authorized = false;
    socket.authorizationError = 'MOTIVO‮ ' + 'Z'.repeat(300);
    socket.emit('secureConnect');
    const { detail } = await pending;
    expect(detail).not.toContain('‮');
    expect(detail.length).toBeLessThan(120);
  });
});

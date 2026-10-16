import { createHmac } from 'node:crypto';
import { sign, verify } from './jwt';

const claims = {
  sub: '7',
  email: 'ana@example.com',
  role: 'Usuario',
  type: 'access' as const,
  sid: 'a'.repeat(32),
};

describe('jwt', () => {
  it('firma y verifica un token válido', () => {
    const payload = verify(sign(claims, 60));
    expect(payload).toMatchObject({
      sub: '7',
      type: 'access',
      iss: 'zeroscam-api',
    });
  });

  it('rechaza un token con el payload alterado', () => {
    const [header, , signature] = sign(claims, 60).split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...claims,
        role: 'Owner',
        iss: 'zeroscam-api',
        iat: 1,
        exp: 9999999999,
      }),
    ).toString('base64url');
    expect(verify(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it('rechaza un token expirado', () => {
    expect(verify(sign(claims, -10))).toBeNull();
  });

  it('rechaza algoritmos distintos de HS256 aunque la firma cuadre con otra llave', () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        ...claims,
        iss: 'zeroscam-api',
        iat: 1,
        exp: 9999999999,
      }),
    ).toString('base64url');
    expect(verify(`${header}.${body}.`)).toBeNull();
    const signature = createHmac('sha256', 'otra-llave')
      .update(`${header}.${body}`)
      .digest('base64url');
    expect(verify(`${header}.${body}.${signature}`)).toBeNull();
  });

  it('nunca lanza con basura', () => {
    for (const junk of [
      '',
      'a',
      'a.b',
      'a.b.c',
      '..',
      '%%%.%%%.%%%',
      'x'.repeat(5000),
    ]) {
      expect(verify(junk)).toBeNull();
    }
  });
});

import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('verifica el password con el que se generó el hash', async () => {
    const stored = await hashPassword('ZeroScam123!');
    expect(stored.startsWith('scrypt:')).toBe(true);
    await expect(verifyPassword('ZeroScam123!', stored)).resolves.toBe(true);
    await expect(verifyPassword('otro', stored)).resolves.toBe(false);
  });

  it('da hashes distintos para el mismo password (sal aleatoria)', async () => {
    const a = await hashPassword('ZeroScam123!');
    const b = await hashPassword('ZeroScam123!');
    expect(a).not.toBe(b);
  });

  it('rechaza cualquier hash que no sea scrypt (el SHA-256 de antes)', async () => {
    // 64 caracteres hexadecimales: el formato del hash anterior.
    await expect(verifyPassword('ZeroScam123!', 'a'.repeat(64))).resolves.toBe(
      false,
    );
  });

  it('rechaza hashes vacíos o de cuentas eliminadas', async () => {
    await expect(verifyPassword('x', undefined)).resolves.toBe(false);
    await expect(verifyPassword('x', '!' + 'a'.repeat(64))).resolves.toBe(
      false,
    );
  });
});

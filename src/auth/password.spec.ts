import { createHash } from 'node:crypto';
import { hashPassword, needsRehash, verifyPassword } from './password';

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

  it('acepta el formato SHA-256 anterior y pide regenerarlo', async () => {
    const legacy = createHash('sha256').update('ZeroScam123!').digest('hex');
    await expect(verifyPassword('ZeroScam123!', legacy)).resolves.toBe(true);
    await expect(verifyPassword('otro', legacy)).resolves.toBe(false);
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(await hashPassword('x'))).toBe(false);
  });

  it('rechaza hashes vacíos o de cuentas eliminadas', async () => {
    await expect(verifyPassword('x', undefined)).resolves.toBe(false);
    await expect(verifyPassword('x', '!' + 'a'.repeat(64))).resolves.toBe(
      false,
    );
  });
});

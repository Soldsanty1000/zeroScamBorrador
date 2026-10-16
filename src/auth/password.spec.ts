import { createHash } from 'node:crypto';
import {
  dummyHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password';

describe('password', () => {
  it('hashea con scrypt y verifica la contraseña correcta', async () => {
    const stored = await hashPassword('Contraseña-Larga-123!');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('Contraseña-Larga-123!', stored)).toBe(true);
    expect(needsRehash(stored)).toBe(false);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const stored = await hashPassword('correcta-1!');
    expect(await verifyPassword('incorrecta-1!', stored)).toBe(false);
  });

  it('usa sal distinta cada vez', async () => {
    expect(await hashPassword('misma-1!')).not.toBe(
      await hashPassword('misma-1!'),
    );
  });

  it('acepta el SHA-256 sin sal de la versión anterior y pide actualizarlo', async () => {
    const legacy = createHash('sha256').update('vieja-1!').digest('hex');
    expect(await verifyPassword('vieja-1!', legacy)).toBe(true);
    expect(await verifyPassword('otra-1!', legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });

  it('rechaza formatos desconocidos, la marca "!" de cuenta desactivada y textos enormes', async () => {
    expect(await verifyPassword('x', '!')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$1$1$AA$AA')).toBe(false);
    expect(await verifyPassword('x'.repeat(300), await hashPassword('x'))).toBe(
      false,
    );
  });

  it('el hash de relleno es válido', async () => {
    expect(await dummyHash()).toMatch(/^scrypt\$/);
  });
});

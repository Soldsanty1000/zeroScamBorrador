import { LoginAttempts } from './login-attempts';

describe('LoginAttempts', () => {
  const key = LoginAttempts.key('Ana@Example.com ', '1.2.3.4');

  it('no bloquea antes del límite', () => {
    const attempts = new LoginAttempts();
    for (let i = 0; i < LoginAttempts.ALLOWED - 1; i++) attempts.fail(key);
    expect(attempts.secondsLocked(key)).toBe(0);
  });

  it('bloquea 1 minuto al llegar al límite y duplica después', () => {
    const attempts = new LoginAttempts();
    const t0 = 1_000_000;
    for (let i = 0; i < LoginAttempts.ALLOWED; i++) attempts.fail(key, t0);
    expect(attempts.secondsLocked(key, t0)).toBe(60);
    attempts.fail(key, t0);
    expect(attempts.secondsLocked(key, t0)).toBe(120);
    expect(attempts.secondsLocked(key, t0 + 121_000)).toBe(0);
  });

  it('nunca pasa de 15 minutos', () => {
    const attempts = new LoginAttempts();
    for (let i = 0; i < 50; i++) attempts.fail(key, 0);
    expect(attempts.secondsLocked(key, 0)).toBe(LoginAttempts.MAX_SECONDS);
  });

  it('un acierto reinicia la cuenta', () => {
    const attempts = new LoginAttempts();
    for (let i = 0; i < LoginAttempts.ALLOWED; i++) attempts.fail(key);
    attempts.success(key);
    expect(attempts.secondsLocked(key)).toBe(0);
  });

  it('bloquea por correo + IP: otra dirección no queda bloqueada', () => {
    const attempts = new LoginAttempts();
    for (let i = 0; i < LoginAttempts.ALLOWED; i++) attempts.fail(key);
    expect(
      attempts.secondsLocked(LoginAttempts.key('ana@example.com', '9.9.9.9')),
    ).toBe(0);
    expect(
      attempts.secondsLocked(LoginAttempts.key('ana@example.com', '1.2.3.4')),
    ).toBeGreaterThan(0);
  });
});

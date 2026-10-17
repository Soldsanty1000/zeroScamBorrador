describe('jwt', () => {
  const claims = {
    sub: '1',
    email: 'ana@zeroscam.mx',
    role: 'Usuario',
    type: 'access' as const,
  };

  // Cada prueba importa el módulo de nuevo: la llave se guarda la primera
  // vez que se lee.
  function load(secret: string | undefined): typeof import('./jwt') {
    jest.resetModules();
    if (secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secret;
    return jest.requireActual('./jwt');
  }

  it('verifica un token que firmó', () => {
    const { sign, verify } = load('x'.repeat(48));
    expect(verify(sign(claims, 60))).toMatchObject(claims);
  });

  it('rechaza un token con la firma alterada o de otra llave', () => {
    const { sign } = load('x'.repeat(48));
    const token = sign(claims, 60);
    const { verify } = load('y'.repeat(48));
    expect(verify(token)).toBeNull();
    const [h, b] = token.split('.');
    expect(verify(`${h}.${b}.firmafalsa`)).toBeNull();
  });

  it('rechaza tokens expirados o mal formados sin lanzar', () => {
    const { sign, verify } = load('x'.repeat(48));
    expect(verify(sign(claims, -10))).toBeNull();
    expect(verify('no-es-un-token')).toBeNull();
    expect(verify('a.b.c')).toBeNull();
  });

  it('no firma sin JWT_SECRET o con una llave corta', () => {
    expect(() => load(undefined).jwtSecret()).toThrow('JWT_SECRET');
    expect(() => load('corta').jwtSecret()).toThrow('JWT_SECRET');
  });
});

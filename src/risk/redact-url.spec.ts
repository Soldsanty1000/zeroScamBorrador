import { redactUrl } from './target';

describe('redactUrl', () => {
  it('quita consulta, fragmento y usuario:clave', () => {
    expect(
      redactUrl(
        'https://usr:pw@banco-falso.example/login?token=abc&correo=a@b.c#x',
      ),
    ).toBe('https://banco-falso.example/login');
  });

  it('conserva host y ruta', () => {
    expect(redactUrl('http://sitio.example/a/b')).toBe(
      'http://sitio.example/a/b',
    );
  });

  it('con texto que no es URL corta en ? o #', () => {
    expect(redactUrl('no-es-url?secreto=1')).toBe('no-es-url');
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CommentDto, SaveCommunityReportDto } from './community.dto';

async function failing<T extends object>(
  cls: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property).sort();
}

const valid = {
  fraudType: 'Oferta Falsa',
  title: 'Tienda falsa de tenis en Instagram',
  description: 'Me cobraron y nunca llegó el paquete que compré.',
  incidentDate: '2026-09-10T18:30:00.000Z',
  anonymous: false,
  affected: 'YO',
  city: 'Guadalajara',
};

describe('SaveCommunityReportDto', () => {
  it('acepta un reporte normal', async () => {
    await expect(failing(SaveCommunityReportDto, valid)).resolves.toEqual([]);
  });

  describe('city', () => {
    it.each([
      'Guadalajara',
      'Ciudad de México',
      'San Luis Potosí',
      'Nueva York',
    ])('acepta %s', async (city) => {
      await expect(
        failing(SaveCommunityReportDto, { ...valid, city }),
      ).resolves.toEqual([]);
    });

    it.each(['A', '12', 'Zapopan 2', 'a1b', '!!'])(
      'rechaza %s',
      async (city) => {
        await expect(
          failing(SaveCommunityReportDto, { ...valid, city }),
        ).resolves.toEqual(['city']);
      },
    );

    it('un texto larguísimo que termina en dígito se rechaza al instante (sin ReDoS)', async () => {
      // Con el patrón anterior, 3000 caracteres tardaban ~12 s en el motor.
      const started = Date.now();
      const errors = await failing(SaveCommunityReportDto, {
        ...valid,
        city: 'a'.repeat(20000) + '1',
      });

      expect(errors).toEqual(['city']);
      expect(Date.now() - started).toBeLessThan(500);
    });
  });

  describe('espacios en las orillas', () => {
    it('diez espacios ya no pasan como título válido', async () => {
      await expect(
        failing(SaveCommunityReportDto, { ...valid, title: ' '.repeat(10) }),
      ).resolves.toEqual(['title']);
    });

    it('el mínimo cuenta texto real, no relleno', async () => {
      await expect(
        failing(SaveCommunityReportDto, {
          ...valid,
          title: 'corto'.padEnd(12, ' '),
          description: 'x'.padEnd(30, ' '),
        }),
      ).resolves.toEqual(['description', 'title']);
    });

    it('un título normal rodeado de espacios sigue valiendo', async () => {
      await expect(
        failing(SaveCommunityReportDto, {
          ...valid,
          title: '   Tienda falsa de tenis   ',
        }),
      ).resolves.toEqual([]);
    });
  });
});

describe('CommentDto', () => {
  it('un comentario de solo espacios se rechaza', async () => {
    await expect(
      failing(CommentDto, { text: ' '.repeat(10) }),
    ).resolves.toEqual(['text']);
  });

  it('admite hasta 500 caracteres', async () => {
    await expect(
      failing(CommentDto, { text: 'a'.repeat(500) }),
    ).resolves.toEqual([]);
    await expect(
      failing(CommentDto, { text: 'a'.repeat(501) }),
    ).resolves.toEqual(['text']);
  });
});

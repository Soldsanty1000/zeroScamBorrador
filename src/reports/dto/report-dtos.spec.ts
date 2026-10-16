import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangeStatusDto } from './change-status.dto';
import { CreateReportDto, MAX_REPORT_URLS } from './create-report.dto';
import { ReportFiltersDto } from './report-filters.dto';
import { UpdateReportDto } from './update-report.dto';

/** Propiedades con error al validar `plain` como `cls`. */
async function failing<T extends object>(
  cls: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

const valid = {
  fraudTypeId: 1,
  description: 'Me llegó un correo del "banco" pidiendo mi NIP',
  incidentDate: '2026-09-10T18:30:00.000Z',
  urls: ['https://banco-seguro-mx.com/login'],
};

describe('límites de los DTO de reportes (API-12)', () => {
  describe('CreateReportDto', () => {
    it('acepta un reporte normal', async () => {
      await expect(failing(CreateReportDto, valid)).resolves.toEqual([]);
    });

    it(`acepta hasta ${MAX_REPORT_URLS} URLs y rechaza más`, async () => {
      const urls = (n: number) =>
        Array.from({ length: n }, (_, i) => `https://sitio${i}.example.com/x`);

      await expect(
        failing(CreateReportDto, { ...valid, urls: urls(MAX_REPORT_URLS) }),
      ).resolves.toEqual([]);
      await expect(
        failing(CreateReportDto, { ...valid, urls: urls(MAX_REPORT_URLS + 1) }),
      ).resolves.toEqual(['urls']);
    });

    it('rechaza una URL de más de 2048 caracteres', async () => {
      const long = 'https://example.com/' + 'a'.repeat(2048);

      await expect(
        failing(CreateReportDto, { ...valid, urls: [long] }),
      ).resolves.toEqual(['urls']);
    });

    it('rechaza una descripción de más de 2000 caracteres', async () => {
      await expect(
        failing(CreateReportDto, { ...valid, description: 'a'.repeat(2001) }),
      ).resolves.toEqual(['description']);
      await expect(
        failing(CreateReportDto, { ...valid, description: 'a'.repeat(2000) }),
      ).resolves.toEqual([]);
    });
  });

  describe('UpdateReportDto hereda los mismos límites', () => {
    it('rechaza demasiadas URLs y una descripción enorme', async () => {
      expect(
        await failing(UpdateReportDto, {
          urls: Array.from(
            { length: 11 },
            (_, i) => `https://s${i}.example.com`,
          ),
          description: 'a'.repeat(2001),
        }),
      ).toEqual(['description', 'urls']);
    });

    it('con todo ausente es válido (edición parcial)', async () => {
      await expect(failing(UpdateReportDto, {})).resolves.toEqual([]);
    });
  });

  describe('ReportFiltersDto', () => {
    it('`q` admite hasta 100 caracteres', async () => {
      await expect(
        failing(ReportFiltersDto, { q: 'a'.repeat(100) }),
      ).resolves.toEqual([]);
      await expect(
        failing(ReportFiltersDto, { q: 'a'.repeat(101) }),
      ).resolves.toEqual(['q']);
    });

    it('los ids numéricos no admiten cadenas kilométricas', async () => {
      await expect(
        failing(ReportFiltersDto, {
          userId: '1'.repeat(19),
          fraudTypeId: '1'.repeat(19),
        }),
      ).resolves.toEqual(['fraudTypeId', 'userId']);
    });
  });

  describe('ChangeStatusDto', () => {
    it('`observations` admite hasta 1000 caracteres', async () => {
      await expect(
        failing(ChangeStatusDto, {
          status: 'RECHAZADO',
          observations: 'a'.repeat(1000),
        }),
      ).resolves.toEqual([]);
      await expect(
        failing(ChangeStatusDto, {
          status: 'RECHAZADO',
          observations: 'a'.repeat(1001),
        }),
      ).resolves.toEqual(['observations']);
    });

    it('RECIBIDO no es un destino válido', async () => {
      await expect(
        failing(ChangeStatusDto, { status: 'RECIBIDO' }),
      ).resolves.toEqual(['status']);
    });
  });
});

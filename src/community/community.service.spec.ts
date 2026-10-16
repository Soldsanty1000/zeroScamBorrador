/* eslint-disable @typescript-eslint/unbound-method */
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { AccountRepository, Profile } from '../account/account.repository';
import { AccountService } from '../account/account.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { reportQuotaExceeded } from '../reports/report-rules';
import { CommunityReport, CommunityRepository } from './community.repository';
import { CommunityService } from './community.service';
import { SaveCommunityReportDto } from './dto/community.dto';

function profile(id: number, role: string): Profile {
  return {
    id,
    role,
    name: 'Nombre',
    lastName: 'Apellido',
    country: 'México',
    alias: `usuario${id}`,
    email: `u${id}@example.com`,
    bio: '',
    avatarFile: undefined,
    accountStatus: 'ACTIVO',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    privacyAcceptedAt: undefined,
    privacyVersion: undefined,
    preferences: {
      notifications: false,
      darkMode: true,
      twoStep: false,
      publicProfile: false,
      analytics: false,
    },
  };
}

const author = profile(5, 'Usuario');
const stranger = profile(6, 'Usuario');
const admin = profile(2, 'Administrador');
const owner = profile(1, 'Owner');

function report(status: string): CommunityReport {
  return {
    id: 3,
    author: {
      id: 5,
      alias: 'usuario5',
      accountStatus: 'ACTIVO',
      publicProfile: false,
    },
    fraudType: 'Oferta Falsa',
    otherType: undefined,
    status,
    title: 'Tienda falsa de tenis en Instagram',
    description: 'Me cobraron y nunca llegó el paquete que compré.',
    incidentDate: new Date('2026-09-10T18:30:00.000Z'),
    riskLevel: 'NO_EVALUADO',
    createdAt: new Date('2026-09-10T18:30:00.000Z'),
    anonymous: false,
    affected: 'YO',
    city: 'Guadalajara',
    suspiciousText: undefined,
    confirmations: 0,
    comments: 0,
    confirmedByViewer: false,
    savedByViewer: false,
    site: undefined,
    evidence: [],
    affectedPerson: undefined,
  };
}

const form: SaveCommunityReportDto = {
  fraudType: 'Oferta Falsa',
  title: 'Tienda falsa de tenis en Instagram',
  description: 'Me cobraron y nunca llegó el paquete que compré.',
  incidentDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  anonymous: false,
  affected: 'YO',
  city: 'Guadalajara',
};

describe('CommunityService', () => {
  let repository: jest.Mocked<CommunityRepository>;
  let accounts: jest.Mocked<AccountService>;
  let analytics: jest.Mocked<AnalyticsService>;
  let audit: jest.Mocked<AuditService>;
  let service: CommunityService;
  let current: Profile;

  function build() {
    return new CommunityService(
      repository,
      accounts,
      {} as unknown as AccountRepository,
      analytics,
      audit,
    );
  }

  /** Quien hace la petición en esta prueba. */
  function actingAs(me: Profile) {
    current = me;
  }

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      addComment: jest.fn(),
      addEvidence: jest.fn(),
      fraudTypeId: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<CommunityRepository>;
    accounts = {
      requireActive: jest.fn(() => Promise.resolve(current)),
    } as unknown as jest.Mocked<AccountService>;
    analytics = {
      count: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AnalyticsService>;
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;
    service = build();
    actingAs(author);
  });

  describe('remove: regla de borrado (API-06)', () => {
    it('el autor borra el suyo en RECIBIDO y queda en la bitácora', async () => {
      repository.findById.mockResolvedValue(report('RECIBIDO'));
      repository.delete.mockResolvedValue({ status: 'RECIBIDO', files: [] });

      await service.remove('5', 3, '10.0.0.5');

      expect(repository.delete).toHaveBeenCalledWith(3, ['RECIBIDO']);
      expect(audit.log).toHaveBeenCalledWith('REPORTE_ELIMINADO', {
        userId: 5,
        detail: 'reporte 3 (RECIBIDO)',
        ip: '10.0.0.5',
      });
    });

    it.each(['EN_REVISION', 'VALIDADO', 'RECHAZADO', 'CANALIZADO'])(
      'el autor NO borra el suyo en %s (409)',
      async (status) => {
        repository.findById.mockResolvedValue(report(status));

        await expect(service.remove('5', 3)).rejects.toBeInstanceOf(
          ConflictException,
        );

        expect(repository.delete).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['Administrador', admin],
      ['Owner', owner],
    ])('%s borra RECIBIDO y RECHAZADO de otros', async (_name, who) => {
      actingAs(who);
      for (const status of ['RECIBIDO', 'RECHAZADO']) {
        repository.findById.mockResolvedValue(report(status));
        repository.delete.mockResolvedValue({ status, files: [] });

        await service.remove(String(who.id), 3, '10.0.0.5');

        expect(repository.delete).toHaveBeenLastCalledWith(3, [
          'RECIBIDO',
          'RECHAZADO',
        ]);
        expect(audit.log).toHaveBeenLastCalledWith('REPORTE_ELIMINADO', {
          userId: who.id,
          detail: `reporte 3 (${status}) por moderación`,
          ip: '10.0.0.5',
        });
      }
    });

    it.each(['EN_REVISION', 'VALIDADO', 'CANALIZADO'])(
      'Administrador y Owner NO borran un %s (409 con motivo claro)',
      async (status) => {
        repository.findById.mockResolvedValue(report(status));
        for (const who of [admin, owner]) {
          actingAs(who);

          await expect(service.remove(String(who.id), 3)).rejects.toThrow(
            /no se puede eliminar.*registro de verificación/,
          );
        }

        expect(repository.delete).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
      },
    );

    it('quien no es el autor ni modera recibe 403 sobre un reporte público', async () => {
      actingAs(stranger);
      repository.findById.mockResolvedValue(report('VALIDADO'));

      await expect(service.remove('6', 3)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('un reporte que no puede ver responde 404, como si no existiera', async () => {
      actingAs(stranger);
      repository.findById.mockResolvedValue(report('RECIBIDO'));

      await expect(service.remove('6', 3)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('si el estado cambió entre la lectura y el borrado, el 409 llega y no se audita', async () => {
      repository.findById.mockResolvedValue(report('RECIBIDO'));
      repository.delete.mockRejectedValue(new ConflictException('ya no'));

      await expect(service.remove('5', 3)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('update: la edición no se cuela tras una revisión', () => {
    it.each(['VALIDADO', 'RECHAZADO', 'CANALIZADO'])(
      'un reporte %s responde 409 sin llegar al UPDATE',
      async (status) => {
        repository.findById.mockResolvedValue(report(status));

        await expect(service.update('5', 3, form)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(repository.update).not.toHaveBeenCalled();
      },
    );

    it.each(['RECIBIDO', 'EN_REVISION'])('en %s edita', async (status) => {
      repository.findById.mockResolvedValue(report(status));
      repository.update.mockResolvedValue([]);

      await service.update('5', 3, form);

      expect(repository.update).toHaveBeenCalledTimes(1);
    });

    it('si lo validaron entre la lectura y el UPDATE, el 409 del repositorio llega tal cual', async () => {
      repository.findById.mockResolvedValue(report('EN_REVISION'));
      repository.update.mockRejectedValue(
        new ConflictException('Este reporte ya fue revisado'),
      );

      await expect(service.update('5', 3, form)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('cuotas (API-16)', () => {
    it('crear: el 429 de la cuota diaria llega y no se cuenta como enviado', async () => {
      repository.create.mockRejectedValue(reportQuotaExceeded());

      await expect(service.create('5', form)).rejects.toMatchObject({
        status: 429,
      });
      expect(analytics.count).not.toHaveBeenCalled();
    });

    it('crear: sin cuota agotada crea el reporte y lo cuenta', async () => {
      repository.create.mockResolvedValue(3);
      repository.findById.mockResolvedValue(report('RECIBIDO'));

      const created = await service.create('5', form);

      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(analytics.count).toHaveBeenCalledWith('reporte_enviado', 5);
      expect(created.id).toBe(3);
    });

    it('comentar: el 429 del repositorio llega sin avisar al autor', async () => {
      repository.findById.mockResolvedValue(report('VALIDADO'));
      repository.addComment.mockRejectedValue(
        new HttpException('Espera un momento', 429),
      );
      actingAs(stranger);

      await expect(service.comment('6', 3, 'hola')).rejects.toMatchObject({
        status: 429,
      });
    });
  });
});

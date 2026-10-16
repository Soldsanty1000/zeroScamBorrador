/* eslint-disable @typescript-eslint/unbound-method */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/jwt';
import { User } from '../auth/entities/user.entity';
import { UsersRepository } from '../auth/users.repository';
import { STATUSES } from '../common/constants';
import { RiskService } from '../risk/risk.service';
import { Report } from './entities/report.entity';
import { STATUS_TRANSITIONS } from './report-rules';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

function token(role: string, sub: string): JwtPayload {
  return {
    sub,
    email: `${sub}@zeroscam.mx`,
    role,
    type: 'access',
    sid: 'a'.repeat(32),
    iss: 'zeroscam-api',
    iat: 0,
    exp: 0,
  };
}

const admin = token('Administrador', '2');
const owner = token('Owner', '1');
const police = token('Policia', '3');
const author = token('Usuario', '7');
const stranger = token('Usuario', '8');

function report(overrides: Partial<Report> = {}): Report {
  return Object.assign(new Report(), {
    id: 12,
    ownerId: '7',
    fraudTypeId: 1,
    fraudType: 'Phishing',
    status: 'RECIBIDO',
    description: 'Me pidieron mi NIP',
    incidentDate: new Date('2026-09-10T18:30:00.000Z'),
    riskLevel: 'NO_EVALUADO',
    urls: ['https://banco-seguro-mx.com/login'],
    evidence: [],
    createdAt: new Date('2026-09-10T18:30:00.000Z'),
    anonymous: false,
    ...overrides,
  });
}

const reporterUser = Object.assign(new User(), {
  id: '7',
  name: 'Danna',
  lastName: 'Azul',
  email: 'dana@example.com',
  country: 'México',
});

describe('ReportsService', () => {
  let repository: jest.Mocked<ReportsRepository>;
  let users: jest.Mocked<UsersRepository>;
  let risk: jest.Mocked<RiskService>;
  let audit: jest.Mocked<AuditService>;
  let service: ReportsService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      findAll: jest.fn(),
      findHistory: jest.fn().mockResolvedValue([]),
      findUrlDetails: jest.fn().mockResolvedValue([]),
      findEvidenceDetails: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      changeStatus: jest.fn(),
      setRisk: jest.fn(),
      addEvidence: jest.fn(),
    } as unknown as jest.Mocked<ReportsRepository>;
    users = {
      findById: jest.fn().mockResolvedValue(reporterUser),
    } as unknown as jest.Mocked<UsersRepository>;
    risk = {
      refreshUrls: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RiskService>;
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;
    service = new ReportsService(repository, users, risk, audit);
  });

  describe('changeStatus: tabla de transiciones', () => {
    const allowed = STATUSES.flatMap((from) =>
      STATUS_TRANSITIONS[from].map((to) => [from, to]),
    );
    const forbidden = STATUSES.flatMap((from) =>
      STATUSES.filter(
        (to) => to !== from && !STATUS_TRANSITIONS[from].includes(to),
      ).map((to) => [from, to]),
    );

    it.each(allowed)(
      '%s -> %s procede, se audita y recalcula el riesgo',
      async (from, to) => {
        repository.findById.mockResolvedValue(report({ status: from }));
        repository.changeStatus.mockResolvedValue(report({ status: to }));

        const result = await service.changeStatus(
          admin,
          12,
          { status: to, observations: 'Dictamen' },
          '10.0.0.5',
        );

        // Se le pasa al repositorio el estado que se validó: ahí se comprueba
        // de nuevo con la fila bloqueada.
        expect(repository.changeStatus).toHaveBeenCalledWith(
          12,
          '2',
          from,
          to,
          'Dictamen',
        );
        expect(audit.log).toHaveBeenCalledWith('REPORTE_ESTADO_CAMBIADO', {
          userId: '2',
          detail: `reporte 12: ${from}->${to}`,
          ip: '10.0.0.5',
        });
        expect(risk.refreshUrls).toHaveBeenCalledTimes(1);
        expect(result.status).toBe(to);
      },
    );

    it.each(forbidden)(
      '%s -> %s responde 409 y no toca nada',
      async (from, to) => {
        repository.findById.mockResolvedValue(report({ status: from }));

        await expect(
          service.changeStatus(admin, 12, { status: to, observations: 'x' }),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(repository.changeStatus).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
        expect(risk.refreshUrls).not.toHaveBeenCalled();
      },
    );

    it.each(STATUSES)('pasar de %s a sí mismo responde 400', async (status) => {
      repository.findById.mockResolvedValue(report({ status }));

      await expect(
        service.changeStatus(admin, 12, { status, observations: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.changeStatus).not.toHaveBeenCalled();
    });

    it('un estado final dice que es final', async () => {
      repository.findById.mockResolvedValue(report({ status: 'CANALIZADO' }));

      await expect(
        service.changeStatus(owner, 12, {
          status: 'RECHAZADO',
          observations: 'x',
        }),
      ).rejects.toThrow('CANALIZADO, que es un estado final');
    });

    it('rechazar sin motivo responde 400', async () => {
      repository.findById.mockResolvedValue(report({ status: 'EN_REVISION' }));

      await expect(
        service.changeStatus(admin, 12, { status: 'RECHAZADO' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.changeStatus).not.toHaveBeenCalled();
    });

    it('si otro administrador movió el reporte, el 409 del repositorio llega tal cual y no se audita', async () => {
      repository.findById.mockResolvedValue(report({ status: 'RECIBIDO' }));
      repository.changeStatus.mockRejectedValue(
        new ConflictException('El reporte cambió de estado'),
      );

      await expect(
        service.changeStatus(admin, 12, { status: 'EN_REVISION' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(audit.log).not.toHaveBeenCalled();
      expect(risk.refreshUrls).not.toHaveBeenCalled();
    });

    it('la bitácora lleva ids y estados, nunca las observaciones', async () => {
      repository.findById.mockResolvedValue(report({ status: 'EN_REVISION' }));
      repository.changeStatus.mockResolvedValue(
        report({ status: 'RECHAZADO' }),
      );

      await service.changeStatus(admin, 12, {
        status: 'RECHAZADO',
        observations: 'texto libre del administrador',
      });

      const [, options] = audit.log.mock.calls[0];
      expect(options?.detail).not.toContain('texto libre');
    });

    it('un reporte que no existe responde 404', async () => {
      repository.findById.mockResolvedValue(undefined);

      await expect(
        service.changeStatus(admin, 99, { status: 'EN_REVISION' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setRisk', () => {
    it('un reporte RECHAZADO no se reclasifica', async () => {
      repository.findById.mockResolvedValue(report({ status: 'RECHAZADO' }));

      await expect(service.setRisk(admin, 12, 'ALTO')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(repository.setRisk).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it.each(['RECIBIDO', 'EN_REVISION', 'VALIDADO', 'CANALIZADO'])(
      'en %s sí se puede, y se audita el cambio de nivel',
      async (status) => {
        repository.findById.mockResolvedValue(report({ status }));
        repository.setRisk.mockResolvedValue({
          report: report({ status, riskLevel: 'ALTO' }),
          previousRiskLevel: 'NO_EVALUADO',
        });

        const result = await service.setRisk(admin, 12, 'ALTO', '10.0.0.5');

        expect(repository.setRisk).toHaveBeenCalledWith(12, '2', 'ALTO');
        expect(audit.log).toHaveBeenCalledWith('REPORTE_RIESGO_CAMBIADO', {
          userId: '2',
          detail: 'reporte 12: NO_EVALUADO->ALTO',
          ip: '10.0.0.5',
        });
        expect(risk.refreshUrls).toHaveBeenCalledTimes(1);
        expect(result.riskLevel).toBe('ALTO');
      },
    );
  });

  describe('remove (legacy, solo el autor)', () => {
    it('borra en RECIBIDO con el filtro de estados del autor y lo audita', async () => {
      repository.findById.mockResolvedValue(report({ status: 'RECIBIDO' }));
      repository.delete.mockResolvedValue({ status: 'RECIBIDO', files: [] });

      await service.remove(author, 12, '10.0.0.5');

      expect(repository.delete).toHaveBeenCalledWith(12, ['RECIBIDO']);
      expect(audit.log).toHaveBeenCalledWith('REPORTE_ELIMINADO', {
        userId: '7',
        detail: 'reporte 12 (RECIBIDO)',
        ip: '10.0.0.5',
      });
    });

    it.each(['EN_REVISION', 'VALIDADO', 'RECHAZADO', 'CANALIZADO'])(
      'en %s responde 409 y no borra',
      async (status) => {
        repository.findById.mockResolvedValue(report({ status }));

        await expect(service.remove(author, 12)).rejects.toBeInstanceOf(
          ConflictException,
        );

        expect(repository.delete).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
      },
    );

    it('el reporte de otro responde 404', async () => {
      repository.findById.mockResolvedValue(report());

      await expect(service.remove(stranger, 12)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('si el estado cambió antes del DELETE, el 409 del repositorio llega y no se audita', async () => {
      repository.findById.mockResolvedValue(report({ status: 'RECIBIDO' }));
      repository.delete.mockRejectedValue(new ConflictException('ya no'));

      await expect(service.remove(author, 12)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('addEvidence (legacy)', () => {
    const file = { buffer: Buffer.from('no importa') } as Express.Multer.File;

    it.each(['EN_REVISION', 'VALIDADO', 'RECHAZADO', 'CANALIZADO'])(
      'en %s responde 409 antes de guardar nada',
      async (status) => {
        repository.findById.mockResolvedValue(report({ status }));

        await expect(
          service.addEvidence(author, 12, file),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(repository.addEvidence).not.toHaveBeenCalled();
      },
    );
  });

  describe('anonimato (API-08)', () => {
    describe('GET /reports/:id', () => {
      it.each([
        ['Administrador', admin],
        ['Owner', owner],
      ])(
        '%s NO recibe `reporter` si el reporte es anónimo',
        async (_name, who) => {
          repository.findById.mockResolvedValue(report({ anonymous: true }));

          const dto = await service.findOne(who, 12);

          expect(dto.anonymous).toBe(true);
          expect(dto.reporter).toBeUndefined();
          // Ni siquiera se consulta al usuario.
          expect(users.findById).not.toHaveBeenCalled();
        },
      );

      it.each([
        ['Administrador', admin],
        ['Owner', owner],
      ])('%s sí recibe `reporter` si no es anónimo', async (_name, who) => {
        repository.findById.mockResolvedValue(report({ anonymous: false }));

        const dto = await service.findOne(who, 12);

        expect(dto.anonymous).toBe(false);
        expect(dto.reporter).toMatchObject({ email: 'dana@example.com' });
      });

      it('el propio autor nunca recibe `reporter`', async () => {
        repository.findById.mockResolvedValue(report());

        const dto = await service.findOne(author, 12);

        expect(dto.reporter).toBeUndefined();
      });
    });

    describe('GET /reports/:id/export', () => {
      const validated = (anonymous: boolean) =>
        report({ status: 'VALIDADO', anonymous });

      it.each([
        ['Administrador', admin],
        ['Owner', owner],
      ])(
        '%s NO exporta `reporter` si el reporte es anónimo',
        async (_name, who) => {
          repository.findById.mockResolvedValue(validated(true));

          const dto = await service.export(who, 12);

          expect(dto.report.anonymous).toBe(true);
          expect(dto.reporter).toBeUndefined();
          expect(users.findById).not.toHaveBeenCalled();
          expect(JSON.stringify(dto)).not.toContain('dana@example.com');
        },
      );

      it('Administrador sí exporta `reporter` si no es anónimo', async () => {
        repository.findById.mockResolvedValue(validated(false));

        const dto = await service.export(admin, 12);

        expect(dto.report.anonymous).toBe(false);
        expect(dto.reporter).toMatchObject({ email: 'dana@example.com' });
      });

      it('la Policía nunca recibe `reporter`', async () => {
        repository.findById.mockResolvedValue(validated(false));

        const dto = await service.export(police, 12);

        expect(dto.reporter).toBeUndefined();
        expect(users.findById).not.toHaveBeenCalled();
      });

      it('cada exportación queda en la bitácora', async () => {
        repository.findById.mockResolvedValue(validated(false));

        await service.export(police, 12, '10.0.0.9');

        expect(audit.log).toHaveBeenCalledWith('REPORTE_EXPORTADO', {
          userId: '3',
          detail: 'reporte 12',
          ip: '10.0.0.9',
        });
      });

      it('un reporte sin validar responde 409 y no se registra como exportado', async () => {
        repository.findById.mockResolvedValue(
          report({ status: 'EN_REVISION' }),
        );

        await expect(service.export(admin, 12)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(audit.log).not.toHaveBeenCalled();
      });
    });
  });
});

/* eslint-disable @typescript-eslint/unbound-method */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { TwoFactorService } from '../auth/two-factor.service';
import { AccountRepository, Profile } from './account.repository';
import { AccountService } from './account.service';

function profile(role: string): Profile {
  return {
    id: 9,
    role,
    name: 'Danna',
    lastName: 'Azul',
    country: 'México',
    alias: 'dana.azul',
    email: 'dana@example.com',
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

describe('AccountService.remove', () => {
  let repository: jest.Mocked<AccountRepository>;
  let audit: jest.Mocked<AuditService>;
  let service: AccountService;
  let stored: string;

  beforeAll(async () => {
    stored = await hashPassword('correcta-123');
  });

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(profile('Usuario')),
      passwordHash: jest.fn().mockResolvedValue(stored),
      deleteAccount: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<AccountRepository>;
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;
    service = new AccountService(
      repository,
      {} as unknown as AuthService,
      {} as unknown as TwoFactorService,
      {} as unknown as AnalyticsService,
      audit,
    );
  });

  it('elimina la cuenta y deja CUENTA_ELIMINADA en la bitácora', async () => {
    await service.remove('9', 'correcta-123', '10.0.0.5');

    expect(repository.deleteAccount).toHaveBeenCalledWith(9);
    expect(audit.log).toHaveBeenCalledWith('CUENTA_ELIMINADA', {
      userId: 9,
      detail: 'cuenta 9',
      ip: '10.0.0.5',
    });
  });

  it('con la contraseña equivocada no borra ni registra nada', async () => {
    await expect(service.remove('9', 'incorrecta')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(repository.deleteAccount).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('el Owner no puede eliminarse desde la app', async () => {
    repository.findById.mockResolvedValue(profile('Owner'));

    await expect(service.remove('9', 'correcta-123')).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(repository.deleteAccount).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('si la transacción falla no se registra como eliminada', async () => {
    repository.deleteAccount.mockRejectedValue(new Error('falló'));

    await expect(service.remove('9', 'correcta-123')).rejects.toThrow('falló');

    expect(audit.log).not.toHaveBeenCalled();
  });
});

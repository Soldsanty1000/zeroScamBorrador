/* eslint-disable @typescript-eslint/unbound-method */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuthService } from './auth.service';
import { EmailCodeService } from './email-code.service';
import { User } from './entities/user.entity';
import { sign } from './jwt';
import { MailService } from './mail.service';
import { hashPassword } from './password';
import { TwoFactorService } from './two-factor.service';
import { UsersRepository } from './users.repository';

const ID = 'a'.repeat(64);

async function user(over: Partial<User> = {}): Promise<User> {
  const u = new User();
  Object.assign(u, {
    id: '7',
    email: 'dana@example.com',
    name: 'Dana',
    role: 'Usuario',
    accountStatus: 'ACTIVO',
    passwordHash: await hashPassword('actual#123'),
    ...over,
  });
  return u;
}

describe('AuthService: contraseña por correo', () => {
  let users: jest.Mocked<UsersRepository>;
  let codes: jest.Mocked<EmailCodeService>;
  let mail: jest.Mocked<MailService>;
  let twoFactor: jest.Mocked<TwoFactorService>;
  let service: AuthService;
  const secret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'x'.repeat(48);
  });
  afterAll(() => {
    if (secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secret;
  });

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      updatePassword: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;
    codes = {
      newId: jest.fn(() => ID),
      expiresFromNow: jest.fn(() => '2026-10-20T00:10:00.000Z'),
      create: jest.fn().mockResolvedValue({
        challengeId: ID,
        destination: 'd•••@example.com',
        expiresAt: '2026-10-20T00:10:00.000Z',
      }),
      verify: jest.fn(),
      clear: jest.fn(),
    } as unknown as jest.Mocked<EmailCodeService>;
    mail = {
      sendPasswordChanged: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MailService>;
    twoFactor = {
      clear: jest.fn(),
    } as unknown as jest.Mocked<TwoFactorService>;
    service = new AuthService(
      users,
      twoFactor,
      { count: jest.fn() } as unknown as AnalyticsService,
      codes,
      mail,
    );
  });

  describe('forgotPassword', () => {
    it('responde igual exista o no la cuenta', async () => {
      users.findByEmail.mockResolvedValueOnce(undefined);
      const sinCuenta = await service.forgotPassword({ email: 'nadie@x.com' });
      users.findByEmail.mockResolvedValueOnce(await user());
      const conCuenta = await service.forgotPassword({
        email: ' Dana@Example.com ',
      });
      expect(Object.keys(sinCuenta)).toEqual(Object.keys(conCuenta));
      expect(sinCuenta.message).toBe(conCuenta.message);
      expect(users.findByEmail).toHaveBeenLastCalledWith('dana@example.com');
      expect(codes.create).toHaveBeenCalledTimes(1);
      expect(codes.create).toHaveBeenCalledWith(
        ID,
        '7',
        'dana@example.com',
        'RECUPERAR',
      );
    });

    it('no manda código a una cuenta suspendida', async () => {
      users.findByEmail.mockResolvedValue(
        await user({ accountStatus: 'SUSPENDIDO' }),
      );
      await service.forgotPassword({ email: 'dana@example.com' });
      expect(codes.create).not.toHaveBeenCalled();
    });

    it('si el envío falla, la respuesta sale igual', async () => {
      users.findByEmail.mockResolvedValue(await user());
      codes.create.mockRejectedValue(new Error('429'));
      await expect(
        service.forgotPassword({ email: 'dana@example.com' }),
      ).resolves.toMatchObject({ challengeId: ID });
    });
  });

  describe('resetPassword', () => {
    it('con el código correcto cambia el password, anula códigos y avisa', async () => {
      codes.verify.mockResolvedValue('7');
      users.findById.mockResolvedValue(await user());
      await service.resetPassword({
        challengeId: ID,
        code: '123456',
        newPassword: 'nueva#456',
      });
      expect(codes.verify).toHaveBeenCalledWith(ID, '123456', 'RECUPERAR');
      expect(users.updatePassword).toHaveBeenCalledWith(
        '7',
        expect.stringMatching(/^scrypt:/),
      );
      expect(codes.clear).toHaveBeenCalledWith('7');
      expect(twoFactor.clear).toHaveBeenCalledWith('7');
      expect(mail.sendPasswordChanged).toHaveBeenCalledWith(
        'dana@example.com',
        expect.any(Date),
        'recuperacion',
      );
    });

    it('con un código inválido no cambia nada', async () => {
      codes.verify.mockResolvedValue(undefined);
      await expect(
        service.resetPassword({
          challengeId: ID,
          code: '000000',
          newPassword: 'nueva#456',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(users.updatePassword).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    const dto = {
      currentPassword: 'actual#123',
      newPassword: 'nueva#456',
      challengeId: ID,
      code: '123456',
    };

    it('exige el código y regresa tokens nuevos', async () => {
      users.findById.mockResolvedValue(await user());
      codes.verify.mockResolvedValue('7');
      const tokens = await service.changePassword('7', dto);
      expect(codes.verify).toHaveBeenCalledWith(ID, '123456', 'CAMBIAR', '7');
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
      expect(mail.sendPasswordChanged).toHaveBeenCalledWith(
        'dana@example.com',
        expect.any(Date),
        'cambio',
      );
    });

    it('rechaza el código de otra cuenta', async () => {
      users.findById.mockResolvedValue(await user());
      codes.verify.mockResolvedValue('8');
      await expect(service.changePassword('7', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('sin un código bueno no dice si el password actual es correcto', async () => {
      users.findById.mockResolvedValue(await user());
      codes.verify.mockResolvedValue(undefined);
      await expect(
        service.changePassword('7', { ...dto, currentPassword: 'otra#000' }),
      ).rejects.toThrow('El código no es válido o ya expiró');
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('con el password actual incorrecto el código ya se gastó', async () => {
      users.findById.mockResolvedValue(await user());
      codes.verify.mockResolvedValue('7');
      await expect(
        service.changePassword('7', { ...dto, currentPassword: 'otra#000' }),
      ).rejects.toThrow('El password actual es incorrecto');
      expect(codes.verify).toHaveBeenCalledTimes(1);
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('un password nuevo igual al actual no gasta el código', async () => {
      users.findById.mockResolvedValue(await user());
      await expect(
        service.changePassword('7', {
          ...dto,
          newPassword: 'actual#123',
          currentPassword: 'actual#123',
        }),
      ).rejects.toThrow('distinto');
      expect(codes.verify).not.toHaveBeenCalled();
    });

    it('si el aviso por correo falla, el cambio queda', async () => {
      users.findById.mockResolvedValue(await user());
      codes.verify.mockResolvedValue('7');
      mail.sendPasswordChanged.mockRejectedValue(new Error('smtp'));
      await expect(service.changePassword('7', dto)).resolves.toHaveProperty(
        'accessToken',
      );
      expect(users.updatePassword).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const token = (iat: number) => {
      jest.spyOn(Date, 'now').mockReturnValueOnce(iat * 1000);
      return sign(
        {
          sub: '7',
          email: 'dana@example.com',
          role: 'Usuario',
          type: 'refresh',
        },
        3600,
      );
    };

    it('rechaza un refresh token emitido antes del cambio de password', async () => {
      const ahora = Math.floor(Date.now() / 1000);
      const viejo = token(ahora - 120);
      users.findById.mockResolvedValue(
        await user({ passwordChangedAt: new Date((ahora - 60) * 1000) }),
      );
      await expect(
        service.refresh({ refreshToken: viejo }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('acepta uno emitido después', async () => {
      const ahora = Math.floor(Date.now() / 1000);
      const nuevo = token(ahora - 10);
      users.findById.mockResolvedValue(
        await user({ passwordChangedAt: new Date((ahora - 60) * 1000) }),
      );
      await expect(
        service.refresh({ refreshToken: nuevo }),
      ).resolves.toHaveProperty('accessToken');
    });

    it('en el mismo segundo del cambio: rechaza el de antes y acepta el de después', async () => {
      const cambio = Math.floor(Date.now() / 1000) * 1000 + 500;
      users.findById.mockResolvedValue(
        await user({ passwordChangedAt: new Date(cambio) }),
      );
      const antes = token((cambio - 300) / 1000);
      const despues = token((cambio + 1) / 1000);
      await expect(
        service.refresh({ refreshToken: antes }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.refresh({ refreshToken: despues }),
      ).resolves.toHaveProperty('accessToken');
    });

    it('rechaza el de una cuenta suspendida', async () => {
      const nuevo = token(Math.floor(Date.now() / 1000));
      users.findById.mockResolvedValue(
        await user({ accountStatus: 'SUSPENDIDO' }),
      );
      await expect(
        service.refresh({ refreshToken: nuevo }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});

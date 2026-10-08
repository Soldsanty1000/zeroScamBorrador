import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuthService } from '../auth/auth.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { ROLES } from '../common/constants';
import {
  AVATARS_DIR,
  readStored,
  removeStored,
  storeUpload,
  UPLOADS_DIR,
} from '../common/files';
import {
  AccountRepository,
  DELETED_STATUS,
  Profile,
} from './account.repository';
import {
  AccountResponseDto,
  RegisterAccountDto,
  UpdateAccountDto,
  UpdatePreferencesDto,
} from './dto/account.dto';

const DEFAULT_PRIVACY_VERSION = '2026-10';

/**
 * Cuenta de la app de iOS: perfil con alias y biografía, preferencias,
 * avatar y eliminación de la cuenta.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * La cuenta del token, si sigue activa. El token no guarda estado, así que
   * aquí se comprueba contra la base en cada petición.
   *
   * @param userId - `sub` del access token.
   * @throws {@link UnauthorizedException} si la cuenta ya no existe.
   * @throws {@link ForbiddenException} si está suspendida.
   */
  async requireActive(userId: string): Promise<Profile> {
    const profile = await this.repository.findById(userId);
    if (!profile || profile.accountStatus === DELETED_STATUS) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    if (profile.accountStatus !== 'ACTIVO') {
      throw new ForbiddenException('La cuenta está suspendida');
    }
    return profile;
  }

  /**
   * Registro desde la app: el de `AuthService` más el alias y la versión del
   * aviso de privacidad aceptada.
   *
   * @throws {@link ConflictException} si el email o el alias ya están en uso.
   */
  async register(dto: RegisterAccountDto): Promise<AccountResponseDto> {
    await this.checkAlias(dto.alias!);
    const created = await this.auth.register(dto);
    await this.repository.completeRegistration(
      created.id,
      dto.alias!,
      dto.privacyVersion ?? DEFAULT_PRIVACY_VERSION,
    );
    return AccountResponseDto.fromProfile(
      (await this.repository.findById(created.id))!,
    );
  }

  async me(userId: string): Promise<AccountResponseDto> {
    return AccountResponseDto.fromProfile(await this.requireActive(userId));
  }

  /**
   * Edita el perfil. Cambiar el email pide el password actual, y se pide
   * antes de decir si el email nuevo ya existe.
   */
  async update(
    userId: string,
    dto: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    const me = await this.requireActive(userId);
    const email = dto.email!.toLowerCase();
    if (email !== me.email) {
      await this.checkPassword(me, dto.currentPassword);
      if (await this.repository.emailTaken(email, me.id)) {
        throw new ConflictException('Ese correo ya tiene una cuenta.');
      }
    }
    if (dto.alias !== me.alias) await this.checkAlias(dto.alias!, me.id);
    await this.repository.updateProfile(me.id, {
      name: dto.name!,
      lastName: dto.lastName!,
      country: dto.country!,
      alias: dto.alias!,
      email,
      bio: dto.bio!,
    });
    return this.me(userId);
  }

  /** Guarda las preferencias. Apagar los dos pasos pide el password. */
  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<AccountResponseDto> {
    const me = await this.requireActive(userId);
    if (me.preferences.twoStep && !dto.twoStep) {
      await this.checkPassword(me, dto.password);
      await this.twoFactor.clear(me.id);
    }
    await this.repository.updatePreferences(me.id, {
      notifications: dto.notifications,
      darkMode: dto.darkMode,
      twoStep: dto.twoStep,
      publicProfile: dto.publicProfile,
      analytics: dto.analytics,
    });
    return this.me(userId);
  }

  /** Reemplaza el avatar por una imagen JPEG. */
  async setAvatar(
    userId: string,
    content: Buffer,
  ): Promise<AccountResponseDto> {
    const me = await this.requireActive(userId);
    const stored = await storeUpload(AVATARS_DIR, content, ['image/jpeg']);
    await this.repository.setAvatar(me.id, stored.fileName);
    if (me.avatarFile) await removeStored(AVATARS_DIR, [me.avatarFile]);
    return this.me(userId);
  }

  async removeAvatar(userId: string): Promise<AccountResponseDto> {
    const me = await this.requireActive(userId);
    await this.repository.setAvatar(me.id, null);
    if (me.avatarFile) await removeStored(AVATARS_DIR, [me.avatarFile]);
    return this.me(userId);
  }

  /**
   * El avatar de una cuenta. Se ve si es el propio, si quien pide modera o si
   * esa persona tiene perfil público.
   *
   * @returns Los bytes JPEG, o `undefined` si no hay o no se puede ver.
   */
  async avatar(userId: string, ofId: number): Promise<Buffer | undefined> {
    const me = await this.requireActive(userId);
    const owner = await this.repository.findById(ofId);
    if (!owner?.avatarFile) return undefined;
    const visible =
      owner.id === me.id || isStaff(me) || owner.preferences.publicProfile;
    return visible ? readStored(AVATARS_DIR, owner.avatarFile) : undefined;
  }

  /** Elimina la cuenta del token; pide el password. El Owner no puede. */
  async remove(userId: string, password: string): Promise<void> {
    const me = await this.requireActive(userId);
    if (me.role === ROLES.OWNER) {
      throw new ConflictException(
        'La cuenta Owner no se puede eliminar desde la app.',
      );
    }
    await this.checkPassword(me, password);
    const evidence = await this.repository.deleteAccount(me.id);
    await removeStored(UPLOADS_DIR, evidence);
    if (me.avatarFile) await removeStored(AVATARS_DIR, [me.avatarFile]);
  }

  /** Todas las cuentas con su perfil de la app. Administrador u Owner. */
  async list(userId: string): Promise<AccountResponseDto[]> {
    await this.requireActive(userId);
    return (await this.repository.findAll()).map((p) =>
      AccountResponseDto.fromProfile(p),
    );
  }

  async analyticsTotals(userId: string): Promise<Record<string, number>> {
    await this.requireActive(userId);
    return this.analytics.totals();
  }

  private async checkAlias(alias: string, exceptId?: number): Promise<void> {
    if (await this.repository.aliasTaken(alias, exceptId)) {
      throw new ConflictException('Ese nombre de usuario ya está en uso.');
    }
  }

  private async checkPassword(me: Profile, password?: string): Promise<void> {
    if (!password) {
      throw new BadRequestException('Confirma tu contraseña para continuar.');
    }
    // Mismo hash que AuthService: es el que está guardado en `contrasena_hash`.
    const hash = createHash('sha256').update(password).digest('hex');
    if (hash !== (await this.repository.passwordHash(me.id))) {
      throw new BadRequestException('La contraseña no es correcta.');
    }
  }
}

/** Administrador y Owner moderan. */
export function isStaff(profile: Profile): boolean {
  return profile.role === ROLES.ADMIN || profile.role === ROLES.OWNER;
}

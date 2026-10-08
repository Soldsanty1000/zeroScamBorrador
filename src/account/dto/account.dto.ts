import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { RegisterDto } from '../../auth/dto/register.dto';
import type { Preferences, Profile } from '../account.repository';

const ALIAS = /^[a-z0-9_.]{3,20}$/;
const ALIAS_MESSAGE =
  'alias lleva de 3 a 20 caracteres: minúsculas, números, punto o guion bajo';

export class RegisterAccountDto extends RegisterDto {
  @ApiProperty({
    type: String,
    example: 'dana.azul',
    description: 'Nombre público, único',
  })
  @Matches(ALIAS, { message: ALIAS_MESSAGE })
  alias: string | undefined;

  @ApiPropertyOptional({
    type: String,
    example: '2026-10',
    description: 'Versión del aviso de privacidad aceptada',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  privacyVersion?: string;
}

export class UpdateAccountDto {
  @ApiProperty({ type: String, example: 'Danna' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string | undefined;

  @ApiProperty({ type: String, example: 'Azul' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string | undefined;

  @ApiProperty({ type: String, example: 'México' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  country: string | undefined;

  @ApiProperty({ type: String, example: 'dana.azul' })
  @Matches(ALIAS, { message: ALIAS_MESSAGE })
  alias: string | undefined;

  @ApiProperty({ type: String, example: 'dana@example.com' })
  @IsEmail()
  @MaxLength(150)
  email: string | undefined;

  @ApiProperty({
    type: String,
    example: '',
    description: 'Hasta 300 caracteres',
  })
  @IsString()
  @MaxLength(300)
  bio: string | undefined;

  @ApiPropertyOptional({
    type: String,
    description: 'Obligatorio solo si cambia el email',
  })
  @IsOptional()
  @IsString()
  currentPassword?: string;
}

export class PreferencesDto implements Preferences {
  @ApiProperty() @IsBoolean() notifications: boolean;
  @ApiProperty() @IsBoolean() darkMode: boolean;
  @ApiProperty({ description: 'Verificación en dos pasos al iniciar sesión' })
  @IsBoolean()
  twoStep: boolean;
  @ApiProperty({ description: 'Mostrar el alias en reportes y comentarios' })
  @IsBoolean()
  publicProfile: boolean;
  @ApiProperty() @IsBoolean() analytics: boolean;
}

export class UpdatePreferencesDto extends PreferencesDto {
  @ApiPropertyOptional({
    type: String,
    description: 'Obligatorio para apagar `twoStep`',
  })
  @IsOptional()
  @IsString()
  password?: string;
}

export class DeleteAccountDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  password: string | undefined;
}

export class PrivacyDto {
  @ApiPropertyOptional({ example: '2026-10' }) version?: string;
  @ApiPropertyOptional({ format: 'date-time' }) acceptedAt?: string;
}

export class AccountResponseDto {
  @ApiProperty({ example: '1', description: 'id_usuario' }) id: string;
  @ApiProperty({ example: 'Usuario' }) role: string;
  @ApiProperty() name: string;
  @ApiProperty() lastName: string;
  @ApiProperty() country: string;
  @ApiProperty({ example: 'dana.azul' }) alias: string;
  @ApiProperty() email: string;
  @ApiProperty() bio: string;
  @ApiProperty({
    description: 'Tiene avatar; se baja de GET /account/avatar/:id',
  })
  hasAvatar: boolean;
  @ApiProperty({ example: 'ACTIVO' }) accountStatus: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: PreferencesDto })
  @Type(() => PreferencesDto)
  preferences: PreferencesDto;
  @ApiProperty({ type: PrivacyDto }) privacy: PrivacyDto;

  static fromProfile(p: Profile): AccountResponseDto {
    const dto = new AccountResponseDto();
    dto.id = String(p.id);
    dto.role = p.role;
    dto.name = p.name;
    dto.lastName = p.lastName;
    dto.country = p.country;
    dto.alias = p.alias;
    dto.email = p.email;
    dto.bio = p.bio;
    dto.hasAvatar = Boolean(p.avatarFile);
    dto.accountStatus = p.accountStatus;
    dto.createdAt = p.createdAt.toISOString();
    dto.preferences = p.preferences;
    dto.privacy = {
      version: p.privacyVersion,
      acceptedAt: p.privacyAcceptedAt?.toISOString(),
    };
    return dto;
  }
}

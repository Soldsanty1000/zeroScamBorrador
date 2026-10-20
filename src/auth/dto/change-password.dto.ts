import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Reglas del password nuevo: las mismas del registro (RF01). */
function NewPassword(): PropertyDecorator {
  return (target, key) => {
    ApiProperty({
      type: String,
      minLength: 8,
      maxLength: 128,
      description:
        'Mismas reglas que en el registro: mínimo 8 caracteres y al menos un ' +
        'carácter especial (RF01)',
      example: 'nuevoPassword456!',
    })(target, key);
    IsString()(target, key);
    MinLength(8)(target, key);
    MaxLength(128)(target, key);
    Matches(/[^A-Za-z0-9]/, {
      message: 'newPassword debe tener al menos un carácter especial',
    })(target, key);
  };
}

/** `challengeId` y código de 6 dígitos que llegó por correo. */
function EmailCode(): PropertyDecorator {
  return (target, key) => {
    ApiProperty({ type: String, example: '042817', description: '6 dígitos' })(
      target,
      key,
    );
    IsString()(target, key);
    Matches(/^[0-9]{6}$/, { message: 'code debe tener 6 dígitos' })(
      target,
      key,
    );
  };
}

function ChallengeId(): PropertyDecorator {
  return (target, key) => {
    ApiProperty({
      type: String,
      description: '`challengeId` que regresó la petición del código',
    })(target, key);
    IsString()(target, key);
    Length(64, 64)(target, key);
  };
}

export class ChangePasswordDto {
  @ApiProperty({ type: String, example: 'password123!' })
  @IsString()
  @MaxLength(128)
  currentPassword: string | undefined;

  @NewPassword()
  newPassword: string | undefined;

  @ChallengeId()
  challengeId: string | undefined;

  @EmailCode()
  code: string | undefined;
}

export class ForgotPasswordDto {
  @ApiProperty({ type: String, example: 'dana@example.com' })
  @IsEmail()
  @MaxLength(150)
  email: string | undefined;
}

export class ResetPasswordDto {
  @ChallengeId()
  challengeId: string | undefined;

  @EmailCode()
  code: string | undefined;

  @NewPassword()
  newPassword: string | undefined;
}

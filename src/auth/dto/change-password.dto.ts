import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ type: String, example: 'password123!' })
  @IsString()
  currentPassword: string | undefined;

  @ApiProperty({
    type: String,
    minLength: 8,
    description:
      'Mismas reglas que en el registro: mínimo 8 caracteres y al menos un ' +
      'carácter especial (RF01)',
    example: 'nuevoPassword456!',
  })
  @IsString()
  @MinLength(8)
  @Matches(/[^A-Za-z0-9]/, {
    message: 'newPassword debe tener al menos un carácter especial',
  })
  newPassword: string | undefined;
}

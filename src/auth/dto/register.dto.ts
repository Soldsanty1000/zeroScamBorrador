import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
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

  @ApiProperty({ type: String, example: 'dana@example.com' })
  @IsEmail()
  email: string | undefined;

  @ApiProperty({
    type: String,
    minLength: 8,
    description: 'Mínimo 8 caracteres y al menos un carácter especial (RF01)',
    example: 'password123!',
  })
  @IsString()
  @MinLength(8)
  @Matches(/[^A-Za-z0-9]/, {
    message: 'password debe tener al menos un carácter especial',
  })
  password: string | undefined;
}

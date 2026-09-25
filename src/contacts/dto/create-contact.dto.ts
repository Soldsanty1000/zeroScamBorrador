import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateContactDto {
  @ApiProperty({ description: 'Nombre completo', example: 'Danna Azul' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Correo del contacto',
    example: 'dana@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '811-123-4567',
    description: 'Teléfono: dígitos, espacios o guiones; puede empezar con +',
  })
  @Matches(/^(\+?[0-9][\s-]*)+$/, { message: 'phone inválido' })
  phone: string;

  @ApiPropertyOptional({
    description: 'Notas libres',
    example: 'compañera de clase',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

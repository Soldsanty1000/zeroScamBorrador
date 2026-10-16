import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RiskQueryDto {
  @ApiProperty({
    description:
      'URL o dominio a verificar (3 a 200 caracteres); se buscan ' +
      'coincidencias parciales',
    minLength: 3,
    maxLength: 200,
    example: 'banco-seguro-mx.com',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  // Es un texto para un LIKE, no una URL completa: 200 sobra para un dominio.
  @MaxLength(200)
  q: string;
}

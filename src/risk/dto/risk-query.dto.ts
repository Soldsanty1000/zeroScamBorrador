import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RiskQueryDto {
  @ApiProperty({
    description: 'URL o dominio a verificar; se buscan coincidencias parciales',
    example: 'banco-seguro-mx.com',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  q: string;
}

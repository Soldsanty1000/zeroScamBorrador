import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { STATUSES } from '../../common/constants';

// Los query params llegan como texto; por eso los ids son IsNumberString.
export class ReportFiltersDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsNumberString()
  @MaxLength(18)
  fraudTypeId?: string;

  @ApiPropertyOptional({
    description: 'Creado desde (ISO 8601)',
    example: '2026-09-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Creado hasta (ISO 8601)',
    example: '2026-09-30T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Palabra clave en la descripción (hasta 100 caracteres)',
    example: 'banco',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Solo Administrador/Owner: reportes de un usuario',
    example: '1',
  })
  @IsOptional()
  @IsNumberString()
  @MaxLength(18)
  userId?: string;
}

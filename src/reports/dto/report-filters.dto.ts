import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
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
    description: 'Palabra clave en la descripción',
    example: 'banco',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Solo Administrador/Owner: reportes de un usuario',
    example: '1',
  })
  @IsOptional()
  @IsNumberString()
  userId?: string;
}

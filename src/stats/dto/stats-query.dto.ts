import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { RISK_LEVELS } from '../../common/constants';

export class StatsQueryDto {
  @ApiPropertyOptional({
    description: 'Reportes creados desde (ISO 8601)',
    example: '2026-09-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Reportes creados hasta (ISO 8601)',
    example: '2026-09-30T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Zona geográfica: país del denunciante',
    example: 'México',
  })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ enum: RISK_LEVELS })
  @IsOptional()
  @IsIn(RISK_LEVELS)
  riskLevel?: string;
}

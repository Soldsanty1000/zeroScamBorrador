import { ApiProperty } from '@nestjs/swagger';
import { CountDto } from './stats-response.dto';

export class UserStatsDto {
  @ApiProperty({
    example: 120,
    description: 'Cuentas registradas en el periodo',
  })
  total: number;

  @ApiProperty({ type: [CountDto] })
  byRole: CountDto[];

  @ApiProperty({ type: [CountDto], description: 'ACTIVO o SUSPENDIDO' })
  byAccountStatus: CountDto[];

  @ApiProperty({ type: [CountDto] })
  byCountry: CountDto[];

  @ApiProperty({
    type: [CountDto],
    description: 'Registros por mes, formato YYYY-MM',
  })
  byMonth: CountDto[];
}

export class UrlStatsDto {
  @ApiProperty({ example: 80, description: 'URLs en el directorio' })
  total: number;

  @ApiProperty({
    example: 65,
    description: 'Las que ya pasaron por el análisis automático',
  })
  analyzed: number;

  @ApiProperty({ type: [CountDto], description: 'Por riesgo global' })
  byRiskLevel: CountDto[];
}

export class LookupStatsDto {
  @ApiProperty({
    example: 300,
    description:
      'Consultas de riesgo en el periodo: cuenta una por usuario y URL, ' +
      'con la fecha de la última vez',
  })
  total: number;

  @ApiProperty({
    example: 45,
    description: 'Usuarios distintos que consultaron',
  })
  users: number;

  @ApiProperty({
    type: [CountDto],
    description: 'Por mes, formato YYYY-MM',
  })
  byMonth: CountDto[];
}

export class NotificationStatsDto {
  @ApiProperty({ example: 210, description: 'Notificaciones enviadas' })
  total: number;

  @ApiProperty({ example: 40, description: 'Todavía sin leer' })
  unread: number;

  @ApiProperty({
    example: 12,
    description: 'Alertas de riesgo de una URL (RF08)',
  })
  riskAlerts: number;
}

export class SiteStatsResponseDto {
  @ApiProperty({ type: UserStatsDto })
  users: UserStatsDto;

  @ApiProperty({
    type: UrlStatsDto,
    description: 'Estado actual del directorio; no depende del periodo',
  })
  urls: UrlStatsDto;

  @ApiProperty({ type: LookupStatsDto })
  lookups: LookupStatsDto;

  @ApiProperty({ type: NotificationStatsDto })
  notifications: NotificationStatsDto;
}

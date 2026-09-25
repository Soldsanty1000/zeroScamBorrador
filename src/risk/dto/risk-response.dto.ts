import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RiskSiteDto {
  @ApiProperty({ example: 'https://banco-seguro-mx.com/login' })
  url: string;

  @ApiProperty({ example: 'ALTO', description: 'BAJO, MEDIO, ALTO o MUY_ALTO' })
  riskLevel: string;

  @ApiPropertyOptional({ example: 'VALIDO' })
  certificateStatus?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'ISO 8601',
    example: '2026-09-10T18:30:00.000Z',
  })
  lastEvaluatedAt?: string;
}

export class RiskFraudTypeCountDto {
  @ApiProperty({ example: 'Phishing' })
  fraudType: string;

  @ApiProperty({ example: 3 })
  count: number;
}

/** Un reporte validado, sin datos de quien lo hizo (RF09). */
export class AnonymousReportDto {
  @ApiProperty({ example: 'Phishing' })
  fraudType: string;

  @ApiProperty({ example: 'Me llegó un correo del "banco" pidiendo mi NIP' })
  description: string;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601',
    example: '2026-09-10T18:30:00.000Z',
  })
  incidentDate: string;

  @ApiProperty({ example: 'ALTO' })
  riskLevel: string;
}

export class RiskResponseDto {
  @ApiProperty({ example: 'banco-seguro-mx.com' })
  query: string;

  @ApiProperty({
    example: 'ALTO',
    description:
      'El riesgo más alto de las URLs encontradas; SIN_REGISTROS si no hay',
  })
  riskLevel: string;

  @ApiProperty({
    example: 3,
    description: 'Reportes VALIDADO o CANALIZADO asociados',
  })
  validatedReports: number;

  @ApiProperty({ type: [RiskFraudTypeCountDto] })
  fraudTypes: RiskFraudTypeCountDto[];

  @ApiProperty({ type: [RiskSiteDto] })
  sites: RiskSiteDto[];

  @ApiProperty({
    type: [AnonymousReportDto],
    description: 'Reportes validados relacionados, anónimos (RF09)',
  })
  reports: AnonymousReportDto[];
}

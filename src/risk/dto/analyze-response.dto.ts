import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Resultado de una de las verificaciones del análisis (RF07). */
export class RiskCheckDto {
  @ApiProperty({
    example: 'certificate',
    description:
      'blacklist, certificate, domainAge, heuristics o communityReports',
  })
  name: string;

  @ApiProperty({
    example: false,
    description: 'true = la verificación no encontró nada sospechoso',
  })
  passed: boolean;

  @ApiProperty({ example: 'Dominio creado hace 5 días' })
  detail: string;
}

export class AnalyzeResponseDto {
  @ApiProperty({
    example: 'https://banco-seguro-mx.com/login',
    description: 'La URL ya normalizada, que es la que se analizó',
  })
  url: string;

  @ApiProperty({ example: 'banco-seguro-mx.com' })
  hostname: string;

  @ApiProperty({ example: 'ALTO', description: 'BAJO, MEDIO, ALTO o MUY_ALTO' })
  riskLevel: string;

  @ApiProperty({
    example: 70,
    description: 'Puntos de riesgo, de 0 (sin señales) a 100',
  })
  score: number;

  @ApiProperty({ type: [RiskCheckDto] })
  checks: RiskCheckDto[];

  @ApiPropertyOptional({
    example: 'VALIDO',
    description: 'VALIDO, INSEGURO, EXPIRADO o INACCESIBLE',
  })
  certificateStatus?: string;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601',
    example: '2026-09-10T18:30:00.000Z',
  })
  evaluatedAt: string;

  @ApiProperty({
    example: false,
    description:
      'true = es un análisis guardado de las últimas 24 horas, no uno nuevo',
  })
  cached: boolean;
}

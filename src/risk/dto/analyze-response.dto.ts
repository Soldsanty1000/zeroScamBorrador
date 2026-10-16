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
    description:
      'true = la verificación se hizo y no encontró nada sospechoso. Una ' +
      'verificación que no se pudo hacer (`verified: false`) nunca pasa',
  })
  passed: boolean;

  @ApiProperty({
    example: true,
    description:
      'false = la verificación no se pudo completar (un servicio externo o ' +
      'el sitio no contestó, falta configuración…): no aportó puntos, pero ' +
      'tampoco significa que esté limpio',
  })
  verified: boolean;

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
      'true = alguna verificación no se pudo completar (`checks[].verified` ' +
      'en false). El nivel sale solo de las señales obtenidas y puede ser ' +
      'más bajo de lo real: no lo tomes como "sitio seguro". Este análisis ' +
      'solo se reutiliza unos minutos y se puede repetir enseguida',
  })
  degraded: boolean;

  @ApiProperty({
    example: false,
    description:
      'true = es un análisis guardado (hasta 24 horas, o unos minutos si ' +
      '`degraded`), no uno nuevo',
  })
  cached: boolean;
}

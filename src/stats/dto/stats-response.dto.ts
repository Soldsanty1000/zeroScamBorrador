import { ApiProperty } from '@nestjs/swagger';

export class CountDto {
  @ApiProperty({ example: 'Phishing' })
  name: string;

  @ApiProperty({ example: 12 })
  count: number;
}

export class StatsResponseDto {
  @ApiProperty({ example: 40, description: 'Reportes que cumplen los filtros' })
  total: number;

  @ApiProperty({ type: [CountDto] })
  byStatus: CountDto[];

  @ApiProperty({ type: [CountDto] })
  byFraudType: CountDto[];

  @ApiProperty({ type: [CountDto] })
  byRiskLevel: CountDto[];

  @ApiProperty({ type: [CountDto], description: 'Por país del denunciante' })
  byCountry: CountDto[];

  @ApiProperty({
    type: [CountDto],
    description: 'Por mes de creación, formato YYYY-MM',
  })
  byMonth: CountDto[];

  @ApiProperty({
    example: 0.75,
    nullable: true,
    description:
      'Aceptados / (aceptados + rechazados); null si no hay ninguno resuelto',
  })
  approvalRate: number | null;
}

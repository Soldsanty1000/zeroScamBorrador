import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FraudTypeDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Phishing' })
  name: string;

  @ApiPropertyOptional({
    example: 'Suplantación de identidad mediante correos o enlaces falsos.',
  })
  description?: string;
}

export class StatusDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'RECIBIDO' })
  name: string;

  @ApiPropertyOptional({ example: 'El reporte ha sido ingresado al sistema.' })
  description?: string;

  @ApiProperty({
    example: false,
    description: 'De un estado final ya no se sale',
  })
  isFinal: boolean;

  @ApiPropertyOptional({ example: 1 })
  order?: number;
}

export class CatalogsResponseDto {
  @ApiProperty({ type: [FraudTypeDto] })
  fraudTypes: FraudTypeDto[];

  @ApiProperty({ type: [StatusDto] })
  statuses: StatusDto[];

  @ApiProperty({
    type: [String],
    example: ['BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO'],
  })
  riskLevels: string[];

  @ApiProperty({
    type: [String],
    example: ['Usuario', 'Administrador', 'Policia', 'Owner'],
  })
  roles: string[];
}

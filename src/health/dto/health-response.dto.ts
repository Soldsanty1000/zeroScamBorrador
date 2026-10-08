import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({
    example: 'ok',
    description: 'ok si todo responde; error si algo de lo que depende no',
  })
  status: string;

  @ApiProperty({ example: 'up', description: 'up o down: la base de datos' })
  database: string;

  @ApiProperty({
    example: 3600,
    description: 'Segundos que lleva arriba el servidor',
  })
  uptime: number;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601',
    example: '2026-09-10T18:30:00.000Z',
  })
  timestamp: string;
}

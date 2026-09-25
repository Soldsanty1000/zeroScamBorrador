import { ApiProperty } from '@nestjs/swagger';
import { Report } from '../entities/report.entity';

export class ReportResponseDto {
  @ApiProperty({ example: 1, description: 'id_reporte' })
  id: number;

  @ApiProperty({ example: 1 })
  fraudTypeId: number;

  @ApiProperty({
    example: 'RECIBIDO',
    description: 'RECIBIDO, EN_REVISION, VALIDADO, RECHAZADO o CANALIZADO',
  })
  status: string;

  @ApiProperty({ example: 'Me llegó un correo del "banco" pidiendo mi NIP' })
  description: string;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601',
    example: '2026-09-10T18:30:00.000Z',
  })
  incidentDate: string;

  @ApiProperty({ example: 'NO_EVALUADO' })
  riskLevel: string;

  @ApiProperty({
    type: [String],
    example: ['https://banco-seguro-mx.com/login'],
  })
  urls: string[];

  @ApiProperty({
    type: [String],
    example: ['/uploads/captura.png'],
    description: 'Rutas de las evidencias, relativas al servidor',
  })
  evidenceUrls: string[];

  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601',
    example: '2026-09-10T18:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({ example: 'Reporte recibido' })
  message: string;

  static fromEntity(report: Report, message: string): ReportResponseDto {
    const dto = new ReportResponseDto();
    dto.id = report.id!;
    dto.fraudTypeId = report.fraudTypeId!;
    dto.status = report.status!;
    dto.description = report.description!;
    dto.incidentDate = report.incidentDate!.toISOString();
    dto.riskLevel = report.riskLevel!;
    dto.urls = report.urls!;
    dto.evidenceUrls = report.evidence!.map((f) => '/uploads/' + f);
    dto.createdAt = report.createdAt!.toISOString();
    dto.message = message;
    return dto;
  }
}

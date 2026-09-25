import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';
import { Report, ReportHistoryEntry } from '../entities/report.entity';

export class ReportHistoryDto {
  @ApiPropertyOptional({ example: 'RECIBIDO', nullable: true })
  fromStatus: string | null;

  @ApiProperty({ example: 'VALIDADO' })
  toStatus: string;

  @ApiPropertyOptional({ example: 'Se confirmó el dominio falso' })
  observations?: string;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601',
    example: '2026-09-10T18:30:00.000Z',
  })
  changedAt: string;

  static fromEntity(entry: ReportHistoryEntry): ReportHistoryDto {
    const dto = new ReportHistoryDto();
    dto.fromStatus = entry.fromStatus ?? null;
    dto.toStatus = entry.toStatus!;
    dto.observations = entry.observations;
    dto.changedAt = entry.changedAt!.toISOString();
    return dto;
  }
}

/** Datos del denunciante; solo los ven Administrador y Owner (CU17). */
export class ReporterDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: 'Danna' })
  name: string;

  @ApiProperty({ example: 'Azul' })
  lastName: string;

  @ApiProperty({ example: 'dana@example.com' })
  email: string;

  @ApiProperty({ example: 'México' })
  country: string;

  static fromEntity(user: User): ReporterDto {
    const dto = new ReporterDto();
    dto.id = user.id!;
    dto.name = user.name!;
    dto.lastName = user.lastName!;
    dto.email = user.email!;
    dto.country = user.country!;
    return dto;
  }
}

export class ReportResponseDto {
  @ApiProperty({ example: 1, description: 'id_reporte' })
  id: number;

  @ApiProperty({ example: 1 })
  fraudTypeId: number;

  @ApiProperty({ example: 'Phishing' })
  fraudType: string;

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

  @ApiProperty({
    example: 'NO_EVALUADO',
    description: 'NO_EVALUADO, BAJO, MEDIO, ALTO o MUY_ALTO',
  })
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

  @ApiPropertyOptional({
    type: [ReportHistoryDto],
    description: 'Cambios de estado; solo en el detalle (GET /reports/:id)',
  })
  history?: ReportHistoryDto[];

  @ApiPropertyOptional({
    type: ReporterDto,
    description: 'Denunciante; solo en el detalle y para Administrador/Owner',
  })
  reporter?: ReporterDto;

  @ApiPropertyOptional({ example: 'Reporte recibido' })
  message?: string;

  static fromEntity(report: Report, message?: string): ReportResponseDto {
    const dto = new ReportResponseDto();
    dto.id = report.id!;
    dto.fraudTypeId = report.fraudTypeId!;
    dto.fraudType = report.fraudType!;
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

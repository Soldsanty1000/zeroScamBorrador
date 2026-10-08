import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReporterDto, ReportHistoryDto } from './report-response.dto';

// Formato estandarizado con el que un reporte verificado se entrega a la
// Policía Cibernética. `format` cambia si cambia la estructura.

/** Versión del formato; quien lo recibe la revisa antes de leer lo demás. */
export const EXPORT_FORMAT = 'zeroscam.expediente.v1';

export class ExportedByDto {
  @ApiProperty({ example: '2', description: 'id_usuario de quien exportó' })
  id: string;

  @ApiProperty({ example: 'Administrador' })
  role: string;
}

export class ExportReportDto {
  @ApiProperty({ example: 1, description: 'id_reporte' })
  id: number;

  @ApiProperty({ example: 'CANALIZADO', description: 'VALIDADO o CANALIZADO' })
  status: string;

  @ApiProperty({ example: 'ALTO' })
  riskLevel: string;

  @ApiProperty({ example: 'Phishing' })
  fraudType: string;

  @ApiProperty({ example: 'Me llegó un correo del "banco" pidiendo mi NIP' })
  description: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-10T18:30:00.000Z' })
  incidentDate: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-10T18:30:00.000Z' })
  createdAt: string;
}

export class ExportUrlDto {
  @ApiProperty({ example: 'https://banco-seguro-mx.com/login' })
  url: string;

  @ApiProperty({ example: 'ALTO', description: 'Riesgo global de la URL' })
  riskLevel: string;

  @ApiPropertyOptional({ example: 'VALIDO' })
  certificateStatus?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Último análisis automático de la URL',
    example: '2026-09-10T18:30:00.000Z',
  })
  lastEvaluatedAt?: string;
}

export class ExportEvidenceDto {
  @ApiProperty({ example: 'captura.png' })
  fileName: string;

  @ApiProperty({
    example: '/uploads/captura.png',
    description: 'Ruta del archivo, relativa al servidor',
  })
  path: string;

  @ApiProperty({ example: 'image/png' })
  mimeType: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-10T18:30:00.000Z' })
  uploadedAt: string;

  @ApiPropertyOptional({
    description:
      'SHA-256 del archivo al momento de exportar, para comprobar después ' +
      'que no cambió; no viene si el archivo ya no está en el servidor',
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  })
  sha256?: string;
}

export class ReportExportDto {
  @ApiProperty({ example: EXPORT_FORMAT })
  format: string;

  @ApiProperty({
    example: 'ZS-2026-000001',
    description: 'ZS, año en que se creó el reporte e id_reporte a 6 dígitos',
  })
  folio: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-10T18:30:00.000Z' })
  generatedAt: string;

  @ApiProperty({ type: ExportedByDto })
  generatedBy: ExportedByDto;

  @ApiProperty({ type: ExportReportDto })
  report: ExportReportDto;

  @ApiPropertyOptional({
    type: ReporterDto,
    description:
      'Denunciante; solo cuando exporta Administrador u Owner, igual que ' +
      'en GET /reports/:id',
  })
  reporter?: ReporterDto;

  @ApiProperty({ type: [ExportUrlDto] })
  urls: ExportUrlDto[];

  @ApiProperty({ type: [ExportEvidenceDto] })
  evidence: ExportEvidenceDto[];

  @ApiProperty({ type: [ReportHistoryDto] })
  history: ReportHistoryDto[];
}

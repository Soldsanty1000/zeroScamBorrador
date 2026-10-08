import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { RISK_LEVELS, STATUSES } from '../../common/constants';

export const AFFECTED = ['YO', 'OTRA_PERSONA'] as const;
export const SCOPES = ['feed', 'mine', 'saved', 'queue'] as const;

export class AffectedPersonDto {
  @ApiProperty({ example: 'María López' })
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({ example: '55 1234 5678', description: 'Teléfono o correo' })
  @IsString()
  @Length(5, 150)
  contact: string;

  @ApiProperty({
    description: 'La persona autorizó compartir sus datos; debe venir en true',
  })
  @Equals(true, {
    message: 'Confirma que la persona te autorizó a compartir sus datos',
  })
  authorized: boolean;
}

export class SaveCommunityReportDto {
  @ApiProperty({
    example: 'Oferta Falsa',
    description: '`nombre_tipo` de GET /catalogs',
  })
  @IsString()
  @MaxLength(50)
  fraudType: string;

  @ApiPropertyOptional({
    description: 'Obligatorio cuando `fraudType` es Otro (3 a 50)',
  })
  @ValidateIf((dto: SaveCommunityReportDto) => dto.fraudType === 'Otro')
  @IsString()
  @Length(3, 50)
  otherType?: string;

  @ApiProperty({
    example: 'Tienda falsa de tenis en Instagram',
    description: '10 a 120',
  })
  @IsString()
  @Length(10, 120)
  title: string;

  @ApiProperty({ description: 'Qué pasó; 20 a 2000' })
  @IsString()
  @Length(20, 2000)
  description: string;

  @ApiProperty({
    format: 'date-time',
    description: 'No futura ni de hace más de un año',
  })
  @IsDateString()
  incidentDate: string;

  @ApiProperty({ description: 'Publicar sin mostrar quién lo reportó' })
  @IsBoolean()
  anonymous: boolean;

  @ApiProperty({ enum: AFFECTED })
  @IsIn(AFFECTED)
  affected: string;

  @ApiPropertyOptional({
    type: AffectedPersonDto,
    description: 'Obligatorio si `affected` es OTRA_PERSONA',
  })
  @ValidateIf((dto: SaveCommunityReportDto) => dto.affected === 'OTRA_PERSONA')
  @ValidateNested()
  @Type(() => AffectedPersonDto)
  affectedPerson?: AffectedPersonDto;

  @ApiProperty({ example: 'Guadalajara', description: '2 a 60' })
  @IsString()
  @Length(2, 60)
  city: string;

  @ApiPropertyOptional({
    example: 'https://n1ke-outlet-mexico.com',
    description: 'Enlace http(s) del fraude',
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({
    description: 'Mensaje o texto del fraude cuando no hay enlace',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  suspiciousText?: string;
}

export class UpdateCommunityReportDto extends SaveCommunityReportDto {
  @ApiPropertyOptional({
    type: [Number],
    description: 'Evidencias ya guardadas que se quitan',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  removeEvidenceIds?: number[];
}

export class CommunityFiltersDto {
  @ApiPropertyOptional({
    enum: SCOPES,
    description: 'feed (default), mine, saved o queue (moderación)',
  })
  @IsOptional()
  @IsIn(SCOPES)
  scope?: (typeof SCOPES)[number];

  @ApiPropertyOptional({ enum: STATUSES, description: 'Solo con scope=queue' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @ApiPropertyOptional({
    description: 'Solo con scope=feed: todas las palabras deben aparecer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Solo con scope=feed: tipos de fraude separados por coma',
  })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  types?: string;

  @ApiPropertyOptional({
    enum: RISK_LEVELS,
    description: 'Solo con scope=feed',
  })
  @IsOptional()
  @IsIn(RISK_LEVELS)
  minRisk?: string;
}

export class CommentDto {
  @ApiProperty({ description: '2 a 500' })
  @IsString()
  @Length(2, 500)
  text: string;
}

// ---------- Respuestas ----------

export class AuthorDto {
  @ApiPropertyOptional({
    description: 'No viene si quien mira no debe saber quién fue',
  })
  userId?: string;
  @ApiProperty({ example: 'Miembro de la comunidad' }) name: string;
}

export class SiteDto {
  @ApiProperty() id: number;
  @ApiProperty() url: string;
  @ApiProperty({ example: 'BAJO' }) riskLevel: string;
  @ApiPropertyOptional() certificateStatus?: string;
  @ApiPropertyOptional({ format: 'date-time' }) lastEvaluatedAt?: string;
}

export class EvidenceDto {
  @ApiProperty({ description: 'Se baja de GET /community/evidence/:id' })
  id: number;
  @ApiProperty({ example: 'image/jpeg' }) mimeType: string;
  @ApiProperty({ format: 'date-time' }) uploadedAt: string;
}

export class CommunityReportDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: AuthorDto }) author: AuthorDto;
  @ApiProperty({ example: 'Oferta Falsa' }) fraudType: string;
  @ApiPropertyOptional() otherType?: string;
  @ApiProperty({ example: 'VALIDADO' }) status: string;
  @ApiProperty() title: string;
  @ApiProperty() description: string;
  @ApiProperty({ format: 'date-time' }) incidentDate: string;
  @ApiProperty({ example: 'ALTO' }) riskLevel: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty() anonymous: boolean;
  @ApiProperty({ enum: AFFECTED }) affected: string;
  @ApiProperty() city: string;
  @ApiPropertyOptional({
    type: AffectedPersonDto,
    description: 'Solo para el autor y quien modera',
  })
  affectedPerson?: AffectedPersonDto;
  @ApiPropertyOptional({ type: SiteDto }) site?: SiteDto;
  @ApiPropertyOptional() suspiciousText?: string;
  @ApiProperty({
    type: [EvidenceDto],
    description: 'Solo para el autor y quien modera',
  })
  evidence: EvidenceDto[];
  @ApiProperty() evidenceCount: number;
  @ApiProperty({ description: 'Cuántos dijeron "Yo también"' })
  confirmations: number;
  @ApiProperty() comments: number;
  @ApiProperty() confirmedByMe: boolean;
  @ApiProperty() savedByMe: boolean;
  @ApiProperty() mine: boolean;
}

export class CommentResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() reportId: number;
  @ApiProperty({ example: 'Tú' }) author: string;
  @ApiProperty() mine: boolean;
  @ApiProperty() text: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class HistoryEntryDto {
  @ApiProperty() id: number;
  @ApiProperty() reportId: number;
  @ApiProperty({ example: 'Equipo de moderación' }) responsible: string;
  @ApiPropertyOptional() fromStatus?: string;
  @ApiProperty() toStatus: string;
  @ApiPropertyOptional() observations?: string;
  @ApiProperty({ format: 'date-time' }) changedAt: string;
}

export class CommunityStatsDto {
  @ApiProperty() peopleHelped: number;
  @ApiProperty() verifiedReports: number;
  @ApiProperty() scamsStopped: number;
  @ApiProperty() zonesCovered: number;
}

export class CategoryDto {
  @ApiProperty({ example: 'Oferta Falsa' }) fraudType: string;
  @ApiProperty() total: number;
  @ApiProperty({ example: 'ALTO' }) maxRisk: string;
}

import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

/** Tope de URLs por reporte. */
export const MAX_REPORT_URLS = 10;

export class CreateReportDto {
  @ApiProperty({
    description:
      'Id del tipo de fraude (1 Phishing, 2 Comercio electrónico, ' +
      '3 Robo de identidad, 4 Inversión/Cripto, 5 Ransomware, 6 Vishing)',
    example: 1,
  })
  @IsInt()
  @Min(1)
  fraudTypeId: number;

  @ApiProperty({
    description: 'Qué pasó (hasta 2000)',
    example: 'Me llegó un correo del "banco" pidiendo mi NIP',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Cuándo ocurrió el incidente (ISO 8601); no puede ser futura',
    example: '2026-09-10T18:30:00.000Z',
  })
  @IsDateString()
  incidentDate: string;

  @ApiProperty({
    type: [String],
    description: `URLs sospechosas del incidente; de 1 a ${MAX_REPORT_URLS}, de hasta 2048 caracteres cada una`,
    example: ['https://banco-seguro-mx.com/login'],
    minItems: 1,
    maxItems: MAX_REPORT_URLS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REPORT_URLS)
  @MaxLength(2048, { each: true })
  @IsUrl({}, { each: true })
  urls: string[];
}

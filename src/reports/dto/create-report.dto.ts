import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

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
    description: 'Qué pasó',
    example: 'Me llegó un correo del "banco" pidiendo mi NIP',
  })
  @IsString()
  @IsNotEmpty()
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
    description: 'URLs sospechosas del incidente; al menos una',
    example: ['https://banco-seguro-mx.com/login'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUrl({}, { each: true })
  urls: string[];
}

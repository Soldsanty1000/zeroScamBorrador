import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// RECIBIDO no está: es solo el estado inicial. Qué transición vale desde cada
// estado lo decide `STATUS_TRANSITIONS` (report-rules.ts), no este DTO.
const TARGET_STATUSES = ['EN_REVISION', 'VALIDADO', 'RECHAZADO', 'CANALIZADO'];

export class ChangeStatusDto {
  @ApiProperty({
    enum: TARGET_STATUSES,
    description:
      'VALIDADO = aceptar (CU19), RECHAZADO = rechazar (CU20), ' +
      'CANALIZADO = enviado a la Policía. Solo se permite RECIBIDO -> ' +
      'EN_REVISION | RECHAZADO, EN_REVISION -> VALIDADO | RECHAZADO y ' +
      'VALIDADO -> CANALIZADO; RECHAZADO y CANALIZADO son finales',
  })
  @IsIn(TARGET_STATUSES)
  status: string;

  @ApiPropertyOptional({
    description: 'Dictamen o motivo (hasta 1000); obligatorio para RECHAZADO',
    example: 'No hay evidencia suficiente',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  observations?: string;
}

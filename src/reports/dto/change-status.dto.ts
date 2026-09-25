import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// RECIBIDO no está: es solo el estado inicial.
const TARGET_STATUSES = ['EN_REVISION', 'VALIDADO', 'RECHAZADO', 'CANALIZADO'];

export class ChangeStatusDto {
  @ApiProperty({
    enum: TARGET_STATUSES,
    description:
      'VALIDADO = aceptar (CU19), RECHAZADO = rechazar (CU20), ' +
      'CANALIZADO = enviado a la Policía',
  })
  @IsIn(TARGET_STATUSES)
  status: string;

  @ApiPropertyOptional({
    description: 'Dictamen o motivo; obligatorio para RECHAZADO',
    example: 'No hay evidencia suficiente',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  observations?: string;
}

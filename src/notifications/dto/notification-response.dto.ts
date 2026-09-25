import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Notification } from '../entities/notification.entity';

export class NotificationResponseDto {
  @ApiProperty({ example: 1, description: 'id_notificacion' })
  id: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Reporte de origen; no viene si es una alerta general',
  })
  reportId?: number;

  @ApiProperty({ example: 'Tu reporte #1 cambió a VALIDADO' })
  message: string;

  @ApiProperty({ example: false })
  read: boolean;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601',
    example: '2026-09-10T18:30:00.000Z',
  })
  sentAt: string;

  static fromEntity(notification: Notification): NotificationResponseDto {
    const dto = new NotificationResponseDto();
    dto.id = notification.id!;
    dto.reportId = notification.reportId;
    dto.message = notification.message!;
    dto.read = notification.read!;
    dto.sentAt = notification.sentAt!.toISOString();
    return dto;
  }
}

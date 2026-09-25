import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class NotificationFiltersDto {
  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'true = solo las no leídas',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  unread?: string;
}

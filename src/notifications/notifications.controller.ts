import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { NotificationFiltersDto } from './dto/notification-filters.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Falta el token, o es inválido o expiró',
  type: ErrorResponseDto,
})
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Mis notificaciones (RF06, CU16)',
    description:
      'Cambios de estado de mis reportes; para Administrador/Owner también ' +
      'los reportes nuevos por revisar. De la más reciente a la más antigua.',
  })
  @ApiOkResponse({ type: NotificationResponseDto, isArray: true })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() filters: NotificationFiltersDto,
  ): Promise<NotificationResponseDto[]> {
    return this.service.findAll(user.sub, filters.unread === 'true');
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar una notificación como leída' })
  @ApiParam({ name: 'id', description: 'id_notificacion', example: 1 })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiNotFoundResponse({
    description: 'Notificación no encontrada',
    type: ErrorResponseDto,
  })
  markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NotificationResponseDto> {
    return this.service.markRead(user.sub, id);
  }
}

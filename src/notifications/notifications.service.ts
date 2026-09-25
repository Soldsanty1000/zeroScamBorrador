import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { NotificationsRepository } from './notifications.repository';

/**
 * Bandeja de notificaciones de cada usuario (RF06, RF08, CU16).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  /**
   * Lista mis notificaciones.
   *
   * @param userId - `sub` del access token.
   * @param onlyUnread - `true` para traer solo las no leídas.
   */
  async findAll(
    userId: string,
    onlyUnread: boolean,
  ): Promise<NotificationResponseDto[]> {
    const notifications = await this.repository.findAll(userId, onlyUnread);
    return notifications.map((n) => NotificationResponseDto.fromEntity(n));
  }

  /**
   * Marca como leída una notificación propia.
   *
   * @param userId - `sub` del access token.
   * @param id - `id_notificacion`.
   * @throws {@link NotFoundException} si no existe o no es del usuario.
   */
  async markRead(userId: string, id: number): Promise<NotificationResponseDto> {
    const notification = await this.repository.markRead(id, userId);
    if (!notification) {
      throw new NotFoundException('Notificación ' + id + ' no encontrada');
    }
    return NotificationResponseDto.fromEntity(notification);
  }
}

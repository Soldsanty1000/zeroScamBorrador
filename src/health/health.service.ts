import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthRepository } from './health.repository';

/**
 * Estado del servicio para el monitoreo de disponibilidad (RNF05).
 */
@Injectable()
export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  /**
   * Revisa que el servidor y la base de datos respondan.
   *
   * @returns El estado, si todo responde.
   * @throws {@link ServiceUnavailableException} (503) con el mismo cuerpo si
   * la base de datos no contesta: sin ella casi ninguna ruta funciona,
   * aunque el servidor siga arriba.
   */
  async check(): Promise<HealthResponseDto> {
    const databaseUp = await this.repository.ping();
    const health: HealthResponseDto = {
      status: databaseUp ? 'ok' : 'error',
      database: databaseUp ? 'up' : 'down',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
    if (!databaseUp) {
      // Un monitor de disponibilidad solo mira el código: con 200 daría el
      // servicio por sano.
      throw new ServiceUnavailableException(health);
    }
    return health;
  }
}

import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('app')
@Controller('health')
export class HealthController {
  constructor(private readonly service: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Estado del servicio (RNF05)',
    description:
      'No requiere token: lo consulta el monitor de disponibilidad. ' +
      'Responde 200 si el servidor y la base de datos contestan, y 503 ' +
      'si la base de datos no.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'La base de datos no responde',
    type: HealthResponseDto,
  })
  check(): Promise<HealthResponseDto> {
    return this.service.check();
  }
}

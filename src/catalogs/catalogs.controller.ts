import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogsService } from './catalogs.service';
import { CatalogsResponseDto } from './dto/catalogs-response.dto';

@ApiTags('catalogs')
@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly service: CatalogsService) {}

  @Get()
  @ApiOperation({
    summary: 'Tipos de fraude, estados, niveles de riesgo y roles',
    description:
      'No requiere token. La app lo usa para llenar selectores (p. ej. el ' +
      '`fraudTypeId` de un reporte).',
  })
  @ApiOkResponse({ type: CatalogsResponseDto })
  findAll(): Promise<CatalogsResponseDto> {
    return this.service.findAll();
  }
}

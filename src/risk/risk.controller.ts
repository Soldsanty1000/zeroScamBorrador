import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto';
import { RiskQueryDto } from './dto/risk-query.dto';
import { RiskResponseDto } from './dto/risk-response.dto';
import { RiskService } from './risk.service';

@ApiTags('risk')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Falta el token, o es inválido o expiró',
  type: ErrorResponseDto,
})
@Controller('risk')
@UseGuards(AuthGuard)
export class RiskController {
  constructor(private readonly service: RiskService) {}

  @Get()
  @ApiOperation({
    summary:
      'Consultar el riesgo de una URL o dominio (CU08, CU13, RF07, RF09)',
    description:
      'Cualquier rol. Busca coincidencias en las URLs reportadas y regresa ' +
      'el nivel de riesgo, cuántos reportes validados hay, por tipo de ' +
      'fraude, y esos reportes sin datos del denunciante.',
  })
  @ApiOkResponse({ type: RiskResponseDto })
  @ApiBadRequestResponse({
    description: 'Falta `q` o es muy corto',
    type: ValidationErrorResponseDto,
  })
  check(@Query() query: RiskQueryDto): Promise<RiskResponseDto> {
    return this.service.check(query.q);
  }
}

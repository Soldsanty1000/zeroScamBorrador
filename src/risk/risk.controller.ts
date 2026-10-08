import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto';
import { AnalyzeResponseDto } from './dto/analyze-response.dto';
import { AnalyzeUrlDto } from './dto/analyze-url.dto';
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

  @Post('analyze')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Analizar una URL (RF07)',
    description:
      'Cualquier rol. Normaliza la URL, corre las verificaciones y regresa ' +
      'el nivel de riesgo con el detalle de cada una. Un sitio que no ' +
      'responde no es un error: regresa 200 con la advertencia. Queda ' +
      'anotado que el usuario la consultó: si su riesgo sube después a ' +
      'ALTO o MUY_ALTO recibe una notificación (RF08).',
  })
  @ApiOkResponse({ type: AnalyzeResponseDto })
  @ApiBadRequestResponse({
    description:
      'URL inválida, con un puerto distinto de 80/443 o que apunta a una ' +
      'dirección interna',
    type: ValidationErrorResponseDto,
  })
  analyze(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AnalyzeUrlDto,
  ): Promise<AnalyzeResponseDto> {
    return this.service.analyze(dto.url, user.sub);
  }
}

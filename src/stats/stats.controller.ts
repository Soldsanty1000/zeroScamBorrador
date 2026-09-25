import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto';
import { ROLES } from '../common/constants';
import { StatsQueryDto } from './dto/stats-query.dto';
import { StatsResponseDto } from './dto/stats-response.dto';
import { StatsService } from './stats.service';

@ApiTags('stats')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Falta el token, o es inválido o expiró',
  type: ErrorResponseDto,
})
@Controller('stats')
@UseGuards(AuthGuard, RolesGuard)
export class StatsController {
  constructor(private readonly service: StatsService) {}

  @Get()
  @Roles(ROLES.ADMIN, ROLES.OWNER, ROLES.POLICE)
  @ApiOperation({
    summary: 'Estadísticas de reportes (CU12, CU21)',
    description:
      'Administrador, Owner o Policia. La Policía solo cuenta reportes ' +
      'VALIDADO o CANALIZADO.',
  })
  @ApiOkResponse({ type: StatsResponseDto })
  @ApiBadRequestResponse({
    description: 'Filtro inválido',
    type: ValidationErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Rol sin acceso',
    type: ErrorResponseDto,
  })
  summary(
    @CurrentUser() user: JwtPayload,
    @Query() query: StatsQueryDto,
  ): Promise<StatsResponseDto> {
    return this.service.summary(user, query);
  }
}

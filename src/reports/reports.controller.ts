import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
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
import { ChangeStatusDto } from './dto/change-status.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportFiltersDto } from './dto/report-filters.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { SetRiskDto } from './dto/set-risk.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ReportsService } from './reports.service';

const ID_PARAM = { name: 'id', description: 'id_reporte', example: 1 };

@ApiTags('reports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Falta el token, o es inválido o expiró',
  type: ErrorResponseDto,
})
@Controller('reports')
@UseGuards(AuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Post()
  @Roles(ROLES.USER)
  @ApiOperation({
    summary: 'Crear un reporte de fraude (CU04). Rol Usuario',
    description:
      'Crea el reporte con el usuario del token como dueño y liga sus URLs. ' +
      'El servidor genera `id`, `status` (RECIBIDO), `riskLevel` ' +
      '(NO_EVALUADO) y `createdAt`, y avisa a los administradores. Las ' +
      'evidencias se suben después en `POST /reports/:id/evidence`.',
  })
  @ApiCreatedResponse({ type: ReportResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido, fecha futura o tipo de fraude inexistente',
    type: ValidationErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Solo el rol Usuario puede crear reportes',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReportDto,
  ): Promise<ReportResponseDto> {
    return this.service.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar reportes (CU05, CU11, CU17)',
    description:
      'Usuario: solo los suyos. Policia: solo VALIDADO o CANALIZADO. ' +
      'Administrador y Owner: todos (y pueden filtrar por `userId`). ' +
      'Del más reciente al más antiguo.',
  })
  @ApiOkResponse({ type: ReportResponseDto, isArray: true })
  @ApiBadRequestResponse({
    description: 'Filtro inválido',
    type: ValidationErrorResponseDto,
  })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() filters: ReportFiltersDto,
  ): Promise<ReportResponseDto[]> {
    return this.service.findAll(user, filters);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver el detalle de un reporte',
    description:
      'Incluye `history`. Administrador y Owner reciben además `reporter` ' +
      '(datos del denunciante). Si el rol no puede verlo responde 404.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ReportResponseDto })
  @ApiNotFoundResponse({
    description: 'Reporte no encontrado',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReportResponseDto> {
    return this.service.findOne(user, id);
  }

  @Patch(':id')
  @Roles(ROLES.USER)
  @ApiOperation({
    summary: 'Editar un reporte propio (CU06). Rol Usuario',
    description:
      'Solo mientras está en RECIBIDO. Solo se modifican los campos que ' +
      'vengan; `urls` reemplaza a las anteriores.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ReportResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido',
    type: ValidationErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Reporte no encontrado',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'El reporte ya está en revisión',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReportDto,
  ): Promise<ReportResponseDto> {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(ROLES.USER)
  @ApiOperation({
    summary: 'Eliminar un reporte propio (CU07). Rol Usuario',
    description:
      'Solo mientras está en RECIBIDO. Borra también sus evidencias.',
  })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: 'Reporte borrado, sin cuerpo' })
  @ApiNotFoundResponse({
    description: 'Reporte no encontrado',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'El reporte ya está en revisión',
    type: ErrorResponseDto,
  })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.service.remove(user, id);
  }

  @Patch(':id/status')
  @Roles(ROLES.ADMIN, ROLES.OWNER)
  @ApiOperation({
    summary: 'Aceptar, rechazar o canalizar un reporte (CU19, CU20)',
    description:
      'Administrador u Owner. Queda en `Historial_Estado`, el denunciante ' +
      'recibe una notificación y se recalcula el riesgo de sus URLs. ' +
      'RECHAZADO exige `observations`.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ReportResponseDto })
  @ApiBadRequestResponse({
    description: 'Estado inválido, repetido o rechazo sin motivo',
    type: ValidationErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Rol sin acceso',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Reporte no encontrado',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'El reporte ya está en un estado final',
    type: ErrorResponseDto,
  })
  changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStatusDto,
  ): Promise<ReportResponseDto> {
    return this.service.changeStatus(user, id, dto);
  }

  @Patch(':id/risk')
  @Roles(ROLES.ADMIN, ROLES.OWNER)
  @ApiOperation({
    summary: 'Clasificar la gravedad de un reporte (CU18)',
    description:
      'Administrador u Owner. Queda registrado en `Historial_Estado` y se ' +
      'recalcula el riesgo de sus URLs.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ReportResponseDto })
  @ApiBadRequestResponse({
    description: 'Nivel inválido',
    type: ValidationErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Rol sin acceso',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Reporte no encontrado',
    type: ErrorResponseDto,
  })
  setRisk(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRiskDto,
  ): Promise<ReportResponseDto> {
    return this.service.setRisk(user, id, dto.riskLevel);
  }

  @Post(':id/evidence')
  @Roles(ROLES.USER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: 'uploads',
        filename: (_req, file, cb) => cb(null, file.originalname),
      }),
    }),
  )
  @ApiOperation({ summary: 'Adjuntar una evidencia a un reporte propio' })
  @ApiParam(ID_PARAM)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: ReportResponseDto })
  @ApiBadRequestResponse({
    description: 'No vino ningún archivo',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Reporte no encontrado',
    type: ErrorResponseDto,
  })
  addEvidence(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ReportResponseDto> {
    if (!file) throw new BadRequestException('Falta el campo file');
    return this.service.addEvidence(user, id, file);
  }
}

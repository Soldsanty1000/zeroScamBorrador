import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
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
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
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
import { MAX_PDF_BYTES } from '../common/files';
import { ChangeStatusDto } from './dto/change-status.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportExportDto } from './dto/report-export.dto';
import { ReportFiltersDto } from './dto/report-filters.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { SetRiskDto } from './dto/set-risk.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ReportsService } from './reports.service';

const ID_PARAM = { name: 'id', description: 'id_reporte', example: 1 };

/** Escrituras caras o abusables: 10 por minuto y por IP (el general es 120). */
const WRITE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

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
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary: 'Crear un reporte de fraude (CU04). Rol Usuario',
    description:
      'Crea el reporte con el usuario del token como dueño y liga sus URLs ' +
      '(de 1 a 10). El servidor genera `id`, `status` (RECIBIDO), ' +
      '`riskLevel` (NO_EVALUADO) y `createdAt`, y avisa a los ' +
      'administradores. Las evidencias se suben después en ' +
      '`POST /reports/:id/evidence`. Máximo 10 reportes por día, contados ' +
      'junto con los de `POST /community/reports`, y 10 peticiones por minuto.',
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
  @ApiTooManyRequestsResponse({
    description: 'Llegaste al límite de reportes por día o por minuto',
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
      'Del más reciente al más antiguo, hasta 500: para ver más antiguos ' +
      'acota con `from`/`to` u otros filtros.',
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
      '(datos del denunciante), salvo que el reporte sea anónimo ' +
      '(`anonymous`): entonces `reporter` no viene para nadie. Si el rol no ' +
      'puede verlo responde 404.',
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

  @Get(':id/export')
  @Roles(ROLES.ADMIN, ROLES.OWNER, ROLES.POLICE)
  @ApiOperation({
    summary: 'Exportar el expediente de un reporte verificado',
    description:
      'Administrador, Owner o Policia. Regresa el reporte en el formato ' +
      'estandarizado para canalizarlo a la Policía Cibernética, como ' +
      'archivo para descargar (`<folio>.json`): datos del reporte, URLs ' +
      'con su riesgo, evidencias con su SHA-256 e historial. Solo reportes ' +
      'VALIDADO o CANALIZADO. El denunciante solo va cuando exporta ' +
      'Administrador u Owner y el reporte no es anónimo. Cada exportación ' +
      'queda en la bitácora de seguridad.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ReportExportDto })
  @ApiForbiddenResponse({
    description: 'Rol sin acceso',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Reporte no encontrado',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'El reporte todavía no está validado',
    type: ErrorResponseDto,
  })
  async export(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    // `passthrough` deja que Nest siga serializando lo que regresa el
    // método; `res` solo se usa para el encabezado.
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ): Promise<ReportExportDto> {
    const dto = await this.service.export(user, id, ip);
    // `attachment` hace que el navegador lo guarde como archivo en vez de
    // mostrarlo.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${dto.folio}.json"`,
    );
    return dto;
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
      'Solo mientras está en RECIBIDO. Borra también sus evidencias y queda ' +
      'en la bitácora de seguridad.',
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
    @Ip() ip: string,
  ): Promise<void> {
    return this.service.remove(user, id, ip);
  }

  @Patch(':id/status')
  @Roles(ROLES.ADMIN, ROLES.OWNER)
  @ApiOperation({
    summary: 'Aceptar, rechazar o canalizar un reporte (CU19, CU20)',
    description:
      'Administrador u Owner. Queda en `Historial_Estado` y en la bitácora ' +
      'de seguridad, el denunciante recibe una notificación y se recalcula ' +
      'el riesgo de sus URLs. RECHAZADO exige `observations`. Solo se ' +
      'permite RECIBIDO -> EN_REVISION | RECHAZADO, EN_REVISION -> ' +
      'VALIDADO | RECHAZADO y VALIDADO -> CANALIZADO; RECHAZADO y ' +
      'CANALIZADO son finales. El cambio es atómico: si otro administrador ' +
      'movió el reporte al mismo tiempo, responde 409.',
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
    description:
      'Transición no permitida (incluye salir de un estado final) o el ' +
      'reporte cambió de estado mientras tanto',
    type: ErrorResponseDto,
  })
  changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStatusDto,
    @Ip() ip: string,
  ): Promise<ReportResponseDto> {
    return this.service.changeStatus(user, id, dto, ip);
  }

  @Patch(':id/risk')
  @Roles(ROLES.ADMIN, ROLES.OWNER)
  @ApiOperation({
    summary: 'Clasificar la gravedad de un reporte (CU18)',
    description:
      'Administrador u Owner. Queda registrado en `Historial_Estado` y en ' +
      'la bitácora de seguridad, y se recalcula el riesgo de sus URLs. Un ' +
      'reporte RECHAZADO no se puede reclasificar (409); los demás estados sí.',
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
  @ApiConflictResponse({
    description: 'El reporte está RECHAZADO y no se puede reclasificar',
    type: ErrorResponseDto,
  })
  setRisk(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRiskDto,
    @Ip() ip: string,
  ): Promise<ReportResponseDto> {
    return this.service.setRisk(user, id, dto.riskLevel, ip);
  }

  @Post(':id/evidence')
  @Roles(ROLES.USER)
  @Throttle(WRITE_LIMIT)
  @UseInterceptors(
    // En memoria y con tope de tamaño: el servicio valida el contenido real
    // (JPEG o PDF), lo cifra y le pone un nombre aleatorio. Jamás se usa el
    // nombre que manda el cliente.
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PDF_BYTES, files: 1 },
    }),
  )
  @ApiOperation({
    summary: 'Adjuntar una evidencia a un reporte propio',
    description:
      'Solo mientras el reporte está en RECIBIDO; máximo 3 archivos por ' +
      'reporte y 10 subidas por minuto.',
  })
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
  @ApiConflictResponse({
    description: 'El reporte ya no está en RECIBIDO',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Demasiadas subidas por minuto',
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

  @Get(':id/evidence/:fileName')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Bajar una evidencia de un reporte',
    description:
      'Quien puede ver el reporte (su autor, Administrador, Owner y, si está ' +
      'VALIDADO o CANALIZADO, Policía). Reemplaza a la ruta pública ' +
      '`/uploads/<archivo>`. Siempre se entrega como descarga.',
  })
  @ApiParam(ID_PARAM)
  @ApiNotFoundResponse({
    description: 'El reporte o la evidencia no existen, o no puedes verlos',
    type: ErrorResponseDto,
  })
  async evidence(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('fileName') fileName: string,
  ): Promise<StreamableFile> {
    const file = await this.service.evidenceFile(user, id, fileName);
    return new StreamableFile(file.content, {
      type: file.mimeType,
      disposition: `attachment; filename="evidencia-${id}${fileName.slice(-4)}"`,
    });
  }
}

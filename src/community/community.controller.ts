import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt';
import { MAX_PDF_BYTES } from '../common/files';
import { CommunityService } from './community.service';
import {
  CategoryDto,
  CommentDto,
  CommentResponseDto,
  CommunityFiltersDto,
  CommunityReportDto,
  CommunityStatsDto,
  HistoryEntryDto,
  PublicProfileDto,
  SaveCommunityReportDto,
  UpdateCommunityReportDto,
} from './dto/community.dto';

/**
 * Rutas de la app de iOS sobre los reportes. Las de `/reports` siguen siendo
 * las del panel de administración; estas agregan la vista comunitaria.
 */
@ApiTags('community')
@ApiBearerAuth()
@Controller('community')
@UseGuards(AuthGuard)
export class CommunityController {
  constructor(private readonly service: CommunityService) {}

  @Get('reports')
  @ApiOperation({
    summary: 'Listar reportes para la app',
    description:
      '`scope=feed`: los VALIDADO y CANALIZADO de toda la comunidad, con ' +
      'filtros `q`, `types` y `minRisk`. `mine`: los míos. `saved`: mis ' +
      'guardados. `queue`: cola de moderación (Administrador u Owner).',
  })
  @ApiOkResponse({ type: CommunityReportDto, isArray: true })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() filters: CommunityFiltersDto,
  ): Promise<CommunityReportDto[]> {
    return this.service.list(user.sub, filters);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Números de la comunidad' })
  @ApiOkResponse({ type: CommunityStatsDto })
  stats(@CurrentUser() user: JwtPayload): Promise<CommunityStatsDto> {
    return this.service.stats(user.sub);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Reportes públicos por tipo de fraude' })
  @ApiOkResponse({ type: CategoryDto, isArray: true })
  categories(@CurrentUser() user: JwtPayload): Promise<CategoryDto[]> {
    return this.service.categories(user.sub);
  }

  @Get('users/:id')
  @ApiOperation({
    summary: 'Perfil público de quien firmó un reporte',
    description:
      'Alias, biografía y sus reportes públicos no anónimos. Solo si la ' +
      'persona activó su perfil público (o es el propio, o moderas); si no, 404.',
  })
  @ApiOkResponse({ type: PublicProfileDto })
  publicProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PublicProfileDto> {
    return this.service.publicProfile(user.sub, id);
  }

  @Get('reports/:id')
  @ApiOperation({
    summary: 'Detalle de un reporte para la app',
    description:
      'Públicos, propios o cualquiera si moderas. La persona afectada y la ' +
      'evidencia solo llegan al autor y a quien modera.',
  })
  @ApiOkResponse({ type: CommunityReportDto })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CommunityReportDto> {
    return this.service.findOne(user.sub, id);
  }

  @Post('reports')
  @ApiOperation({
    summary: 'Crear un reporte desde la app',
    description: 'Nace en RECIBIDO. Máximo 10 por día.',
  })
  @ApiCreatedResponse({ type: CommunityReportDto })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SaveCommunityReportDto,
  ): Promise<CommunityReportDto> {
    return this.service.create(user.sub, dto);
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary: 'Editar un reporte propio',
    description: 'Solo en RECIBIDO o EN_REVISION. Reemplaza todos los campos.',
  })
  @ApiOkResponse({ type: CommunityReportDto })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCommunityReportDto,
  ): Promise<CommunityReportDto> {
    return this.service.update(user.sub, id, dto);
  }

  @Delete('reports/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Eliminar un reporte propio (o cualquiera si moderas)',
  })
  @ApiNoContentResponse({ description: 'Reporte eliminado, sin cuerpo' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.service.remove(user.sub, id);
  }

  @Post('reports/:id/evidence')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PDF_BYTES, files: 1 },
    }),
  )
  @ApiOperation({
    summary: 'Adjuntar evidencia a un reporte propio',
    description: 'JPEG (5 MB) o PDF (10 MB). Máximo 3 por reporte.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: CommunityReportDto })
  addEvidence(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<CommunityReportDto> {
    if (!file) throw new BadRequestException('Falta el campo file');
    return this.service.addEvidence(user.sub, id, file.buffer);
  }

  @Get('evidence/:id')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Bajar una evidencia',
    description:
      'Solo el autor del reporte y quien modera. 404 para los demás.',
  })
  async evidence(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const file = await this.service.evidence(user.sub, id);
    // Nunca se muestra dentro del origen de la API: siempre como descarga.
    return new StreamableFile(file.content, {
      type: file.mimeType,
      disposition: 'attachment; filename="evidencia-' + id + '"',
    });
  }

  @Put('reports/:id/saved')
  @HttpCode(204)
  @ApiOperation({ summary: 'Guardar un reporte (idempotente)' })
  @ApiNoContentResponse()
  save(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.service.setSaved(user.sub, id, true);
  }

  @Delete('reports/:id/saved')
  @HttpCode(204)
  @ApiOperation({ summary: 'Quitar un reporte de mis guardados (idempotente)' })
  @ApiNoContentResponse()
  unsave(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.service.setSaved(user.sub, id, false);
  }

  @Post('reports/:id/confirmations')
  @HttpCode(200)
  @ApiOperation({
    summary: '"Yo también": confirmar un reporte público',
    description: 'Una vez por usuario; repetirlo no cambia nada. No el propio.',
  })
  @ApiOkResponse({ type: CommunityReportDto })
  confirm(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CommunityReportDto> {
    return this.service.confirm(user.sub, id);
  }

  @Get('reports/:id/comments')
  @ApiOperation({
    summary: 'Comentarios de un reporte, del más nuevo al más antiguo',
  })
  @ApiOkResponse({ type: CommentResponseDto, isArray: true })
  comments(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CommentResponseDto[]> {
    return this.service.comments(user.sub, id);
  }

  @Post('reports/:id/comments')
  @ApiOperation({
    summary: 'Comentar un reporte público',
    description: 'Máximo 5 por minuto. Avisa al autor del reporte.',
  })
  @ApiCreatedResponse({ type: CommentResponseDto })
  comment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CommentDto,
  ): Promise<CommentResponseDto> {
    return this.service.comment(user.sub, id, dto.text);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Borrar un comentario propio (o cualquiera si moderas)',
  })
  @ApiNoContentResponse()
  removeComment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.service.removeComment(user.sub, id);
  }

  @Get('reports/:id/history')
  @ApiOperation({
    summary: 'Historial de estados de un reporte',
    description: 'Para su autor y quien modera.',
  })
  @ApiOkResponse({ type: HistoryEntryDto, isArray: true })
  history(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HistoryEntryDto[]> {
    return this.service.history(user.sub, id);
  }
}

@ApiTags('account')
@ApiBearerAuth()
@Controller('account')
@UseGuards(AuthGuard)
export class AccountExportController {
  constructor(private readonly service: CommunityService) {}

  @Get('export')
  @ApiOperation({
    summary: 'Descargar mis datos',
    description:
      'Derecho de acceso: mi cuenta, mis reportes y comentarios, lo que ' +
      'guardé y confirmé, y mis notificaciones.',
  })
  export(@CurrentUser() user: JwtPayload): Promise<Record<string, unknown>> {
    return this.service.export(user.sub);
  }
}

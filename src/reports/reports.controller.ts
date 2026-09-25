import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Falta el token, o es inválido o expiró',
  type: ErrorResponseDto,
})
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear un reporte de fraude (CU04)',
    description:
      'Crea el reporte con el usuario del token como dueño y liga sus URLs. ' +
      'El servidor genera `id`, `status` (RECIBIDO), `riskLevel` ' +
      '(NO_EVALUADO) y `createdAt`. Las evidencias se suben después en ' +
      '`POST /reports/:id/evidence`.',
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

  @Post(':id/evidence')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: 'uploads',
        filename: (_req, file, cb) => cb(null, file.originalname),
      }),
    }),
  )
  @ApiOperation({ summary: 'Adjuntar una evidencia a un reporte propio' })
  @ApiParam({ name: 'id', description: 'id_reporte', example: 1 })
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

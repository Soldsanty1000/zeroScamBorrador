/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { ReportsRepository } from './reports.repository';

/**
 * Reglas de negocio de los reportes de fraude.
 *
 * No sabe de HTTP ni de SQL: recibe DTOs ya validados, habla con el
 * repository y regresa `ReportResponseDto`.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly repository: ReportsRepository) {}

  /**
   * Crea un reporte (CU04). Nace en estado RECIBIDO y con riesgo
   * NO_EVALUADO.
   *
   * @param user - Payload del access token.
   * @param data - Body ya validado (`CreateReportDto`).
   * @returns El reporte creado, tal como quedó en la base.
   * @throws {@link ForbiddenException} si el rol no es `Usuario`.
   * @throws {@link BadRequestException} si la fecha es futura o
   * `fraudTypeId` no existe.
   */
  async create(
    user: JwtPayload,
    data: CreateReportDto,
  ): Promise<ReportResponseDto> {
    // Regla "Autoría de reportes": solo el rol Usuario levanta reportes.
    if (user.role !== 'Usuario') {
      throw new ForbiddenException('Solo el rol Usuario puede crear reportes');
    }
    const incidentDate = new Date(data.incidentDate);
    if (incidentDate > new Date()) {
      throw new BadRequestException(
        'incidentDate no puede ser posterior a hoy',
      );
    }
    try {
      const report = await this.repository.save(user.sub, {
        fraudTypeId: data.fraudTypeId,
        description: data.description,
        incidentDate,
        urls: data.urls,
      });
      return ReportResponseDto.fromEntity(report, 'Reporte recibido');
    } catch (err) {
      // La llave foránea a TipoFraude es la que valida el tipo.
      if (err?.code === 'ER_NO_REFERENCED_ROW_2') {
        throw new BadRequestException(
          'Tipo de fraude ' + data.fraudTypeId + ' no existe',
        );
      }
      throw err;
    }
  }

  /**
   * Asocia al reporte un archivo de evidencia que Multer ya dejó en
   * `uploads/`.
   *
   * @param user - Payload del access token.
   * @param id - `id_reporte`.
   * @param file - Archivo recibido; `file.filename` es el nombre en disco.
   * @throws {@link NotFoundException} si el reporte no existe o no es del
   * usuario del token.
   */
  async addEvidence(
    user: JwtPayload,
    id: number,
    file: Express.Multer.File,
  ): Promise<ReportResponseDto> {
    // RNF04: cada usuario solo ve sus propios reportes. Si no es suyo,
    // respondemos igual que si no existiera.
    const report = await this.repository.findById(id);
    if (!report || report.ownerId !== user.sub) {
      throw new NotFoundException('Reporte ' + id + ' no encontrado');
    }
    const updated = (await this.repository.addEvidence(
      id,
      file.filename,
      file.mimetype,
    ))!;
    return ReportResponseDto.fromEntity(updated, 'Evidencia agregada');
  }
}

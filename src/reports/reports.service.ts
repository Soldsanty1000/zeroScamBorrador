/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/jwt';
import { UsersRepository } from '../auth/users.repository';
import { POLICE_VISIBLE_STATUSES, ROLES } from '../common/constants';
import {
  STORED_FILE_NAME,
  UPLOADS_DIR,
  mimeOfStored,
  readStored,
  removeStored,
  storeUpload,
} from '../common/files';
import { RiskService } from '../risk/risk.service';
import { ChangeStatusDto } from './dto/change-status.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { EXPORT_FORMAT, ReportExportDto } from './dto/report-export.dto';
import { ReportFiltersDto } from './dto/report-filters.dto';
import {
  ReporterDto,
  ReportHistoryDto,
  ReportResponseDto,
} from './dto/report-response.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { Report } from './entities/report.entity';
import {
  AUTHOR_DELETABLE_STATUSES,
  canTransition,
  invalidTransition,
} from './report-rules';
import { ReportsRepository } from './reports.repository';

/** Máximo de archivos de evidencia por reporte (igual que en la comunidad). */
const MAX_EVIDENCE = 3;

/**
 * Reglas de negocio de los reportes de fraude.
 *
 * No sabe de HTTP ni de SQL: recibe DTOs ya validados, habla con el
 * repository y regresa `ReportResponseDto`. Qué reportes ve cada quien
 * depende del rol del token (RNF04):
 *
 * - Usuario: solo los suyos.
 * - Policia: solo los VALIDADO o CANALIZADO.
 * - Administrador y Owner: todos.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly repository: ReportsRepository,
    private readonly users: UsersRepository,
    private readonly risk: RiskService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Crea un reporte (CU04). Nace en estado RECIBIDO y con riesgo
   * NO_EVALUADO. Solo el rol Usuario (lo revisa el controller).
   *
   * @param user - Payload del access token.
   * @param data - Body ya validado (`CreateReportDto`).
   * @returns El reporte creado, tal como quedó en la base.
   * @throws {@link BadRequestException} si la fecha es futura o
   * `fraudTypeId` no existe.
   */
  async create(
    user: JwtPayload,
    data: CreateReportDto,
  ): Promise<ReportResponseDto> {
    const incidentDate = checkIncidentDate(data.incidentDate);
    const report = await withFraudTypeCheck(data.fraudTypeId, () =>
      this.repository.save(user.sub, {
        fraudTypeId: data.fraudTypeId,
        description: data.description,
        incidentDate,
        urls: data.urls,
      }),
    );
    return ReportResponseDto.fromEntity(report, 'Reporte recibido');
  }

  /**
   * Lista los reportes que el rol del token puede ver (CU05, CU11, CU17).
   *
   * @param user - Payload del access token.
   * @param filters - Filtros opcionales del query string.
   * @returns Los reportes, del más reciente al más antiguo.
   */
  async findAll(
    user: JwtPayload,
    filters: ReportFiltersDto,
  ): Promise<ReportResponseDto[]> {
    const isStaff = user.role === ROLES.ADMIN || user.role === ROLES.OWNER;
    const reports = await this.repository.findAll({
      // `userId` solo lo pueden usar Administrador y Owner.
      ownerId:
        user.role === ROLES.USER
          ? user.sub
          : isStaff
            ? filters.userId
            : undefined,
      statuses:
        user.role === ROLES.POLICE ? POLICE_VISIBLE_STATUSES : undefined,
      status: filters.status,
      fraudTypeId: filters.fraudTypeId
        ? Number(filters.fraudTypeId)
        : undefined,
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
      q: filters.q,
    });
    return reports.map((r) => ReportResponseDto.fromEntity(r));
  }

  /**
   * Detalle de un reporte con su historial; Administrador y Owner también
   * reciben los datos del denunciante (CU17), salvo que el reporte sea
   * anónimo: entonces nadie recibe `reporter`.
   *
   * @param user - Payload del access token.
   * @param id - `id_reporte`.
   * @throws {@link NotFoundException} si no existe o el rol no lo puede ver.
   */
  async findOne(user: JwtPayload, id: number): Promise<ReportResponseDto> {
    const report = await this.findVisible(user, id);
    const dto = ReportResponseDto.fromEntity(report);
    dto.history = (await this.repository.findHistory(id)).map((h) =>
      ReportHistoryDto.fromEntity(h),
    );
    // Un reporte anónimo no revela al autor ni a la administración: ni
    // siquiera se consulta al usuario.
    if (isModerator(user) && !report.anonymous) {
      const reporter = await this.users.findById(report.ownerId!);
      if (reporter) dto.reporter = ReporterDto.fromEntity(reporter);
    }
    return dto;
  }

  /**
   * Edita un reporte propio mientras siga en RECIBIDO (CU06).
   *
   * @param user - Payload del access token.
   * @param id - `id_reporte`.
   * @param changes - Campos a cambiar; `urls` reemplaza a las anteriores.
   * @throws {@link NotFoundException} si no existe o no es suyo.
   * @throws {@link ConflictException} si ya está en revisión.
   */
  async update(
    user: JwtPayload,
    id: number,
    changes: UpdateReportDto,
  ): Promise<ReportResponseDto> {
    await this.findEditable(user, id);
    const updated = await withFraudTypeCheck(changes.fraudTypeId, () =>
      this.repository.update(id, {
        fraudTypeId: changes.fraudTypeId,
        description: changes.description,
        incidentDate: changes.incidentDate
          ? checkIncidentDate(changes.incidentDate)
          : undefined,
        urls: changes.urls,
      }),
    );
    return ReportResponseDto.fromEntity(
      updated!,
      'Reporte actualizado correctamente',
    );
  }

  /**
   * Borra un reporte propio mientras siga en RECIBIDO (CU07), junto con los
   * archivos de sus evidencias. Queda en la bitácora (REPORTE_ELIMINADO).
   *
   * @param user - Payload del access token.
   * @param id - `id_reporte`.
   * @param ip - Dirección del cliente, para la bitácora.
   * @throws {@link NotFoundException} si no existe o no es suyo.
   * @throws {@link ConflictException} si ya está en revisión.
   */
  async remove(user: JwtPayload, id: number, ip?: string): Promise<void> {
    await this.findEditable(user, id);
    // El repositorio vuelve a comprobar el estado con la fila bloqueada.
    const deleted = await this.repository.delete(id, AUTHOR_DELETABLE_STATUSES);
    await this.audit.log('REPORTE_ELIMINADO', {
      userId: user.sub,
      detail: `reporte ${id} (${deleted.status})`,
      ip,
    });
    // Si un archivo ya no está en disco no pasa nada: el reporte ya se borró.
    await removeStored(UPLOADS_DIR, deleted.files);
  }

  /**
   * Cambia el estado de un reporte: aceptar (VALIDADO, CU19), rechazar
   * (RECHAZADO, CU20), pasar a revisión o canalizar, y recalcula el riesgo
   * de sus URLs. Administrador u Owner.
   *
   * Solo valen las transiciones de `STATUS_TRANSITIONS`: RECIBIDO ->
   * EN_REVISION | RECHAZADO, EN_REVISION -> VALIDADO | RECHAZADO y VALIDADO
   * -> CANALIZADO. RECHAZADO y CANALIZADO son finales. El cambio es atómico
   * (ver `ReportsRepository.changeStatus`) y queda en la bitácora
   * (REPORTE_ESTADO_CAMBIADO).
   *
   * @param user - Payload del access token.
   * @param id - `id_reporte`.
   * @param data - Estado nuevo y observaciones.
   * @param ip - Dirección del cliente, para la bitácora.
   * @throws {@link NotFoundException} si no existe.
   * @throws {@link BadRequestException} si es el mismo estado o se rechaza
   * sin motivo.
   * @throws {@link ConflictException} si la transición no está permitida
   * (incluido salir de un estado final) o el reporte cambió de estado
   * mientras tanto.
   */
  async changeStatus(
    user: JwtPayload,
    id: number,
    data: ChangeStatusDto,
    ip?: string,
  ): Promise<ReportResponseDto> {
    const report = await this.findVisible(user, id);
    const from = report.status!;
    if (from === data.status) {
      throw new BadRequestException('El reporte ya está en ' + data.status);
    }
    if (!canTransition(from, data.status)) {
      throw invalidTransition(from, data.status);
    }
    if (data.status === 'RECHAZADO' && !data.observations) {
      throw new BadRequestException(
        'Para rechazar hay que indicar el motivo en observations',
      );
    }
    // El repositorio vuelve a comprobar `from` con la fila bloqueada: si otro
    // administrador movió el reporte entre la lectura y aquí, responde 409.
    const updated = await this.repository.changeStatus(
      id,
      user.sub,
      from,
      data.status,
      data.observations,
    );
    // Solo ids y estados: las observaciones son texto libre y no van a la bitácora.
    await this.audit.log('REPORTE_ESTADO_CAMBIADO', {
      userId: user.sub,
      detail: `reporte ${id}: ${from}->${data.status}`,
      ip,
    });
    // Validar, rechazar o canalizar cambia qué reportes cuentan para el
    // riesgo de sus URLs.
    await this.risk.refreshUrls(updated.urls!);
    return ReportResponseDto.fromEntity(
      updated,
      'Estado actualizado a ' + data.status,
    );
  }

  /**
   * Clasifica la gravedad de un reporte (CU18) y recalcula el riesgo de sus
   * URLs. Administrador u Owner. Un reporte RECHAZADO ya no se reclasifica;
   * los demás estados sí. Queda en la bitácora (REPORTE_RIESGO_CAMBIADO).
   *
   * @param user - Payload del access token.
   * @param id - `id_reporte`.
   * @param riskLevel - BAJO, MEDIO, ALTO o MUY_ALTO.
   * @param ip - Dirección del cliente, para la bitácora.
   * @throws {@link NotFoundException} si no existe.
   * @throws {@link ConflictException} si el reporte está RECHAZADO.
   */
  async setRisk(
    user: JwtPayload,
    id: number,
    riskLevel: string,
    ip?: string,
  ): Promise<ReportResponseDto> {
    const report = await this.findVisible(user, id);
    if (report.status === 'RECHAZADO') {
      throw new ConflictException(
        'El reporte está RECHAZADO y no se puede reclasificar',
      );
    }
    // El repositorio vuelve a comprobarlo con la fila bloqueada.
    const { report: updated, previousRiskLevel } =
      await this.repository.setRisk(id, user.sub, riskLevel);
    await this.audit.log('REPORTE_RIESGO_CAMBIADO', {
      userId: user.sub,
      detail: `reporte ${id}: ${previousRiskLevel}->${riskLevel}`,
      ip,
    });
    await this.risk.refreshUrls(updated.urls!);
    return ReportResponseDto.fromEntity(
      updated,
      'Nivel de riesgo asignado: ' + riskLevel,
    );
  }

  /**
   * Arma el expediente de un reporte verificado en el formato estandarizado
   * con el que se canaliza a la Policía Cibernética.
   *
   * @param user - Payload del access token.
   * @param id - `id_reporte`.
   * @param ip - Dirección del cliente, para la bitácora.
   * @returns El expediente: datos del reporte, URLs con su riesgo, evidencias
   * con su huella SHA-256 e historial. El denunciante solo va cuando exporta
   * Administrador u Owner y el reporte NO es anónimo. Cada exportación queda
   * en la bitácora (REPORTE_EXPORTADO).
   * @throws {@link NotFoundException} si no existe o el rol no lo puede ver.
   * @throws {@link ConflictException} si el reporte no está VALIDADO ni
   * CANALIZADO: solo se exportan reportes verificados.
   */
  async export(
    user: JwtPayload,
    id: number,
    ip?: string,
  ): Promise<ReportExportDto> {
    const report = await this.findVisible(user, id);
    if (!POLICE_VISIBLE_STATUSES.includes(report.status!)) {
      throw new ConflictException(
        'El reporte está en ' +
          report.status +
          ': solo se exportan reportes VALIDADO o CANALIZADO',
      );
    }
    const [urls, evidence, history] = await Promise.all([
      this.repository.findUrlDetails(id),
      this.repository.findEvidenceDetails(id),
      this.repository.findHistory(id),
    ]);
    const dto = new ReportExportDto();
    dto.format = EXPORT_FORMAT;
    dto.folio = folio(report);
    dto.generatedAt = new Date().toISOString();
    dto.generatedBy = { id: user.sub, role: user.role };
    dto.report = {
      id: report.id!,
      status: report.status!,
      riskLevel: report.riskLevel!,
      fraudType: report.fraudType!,
      description: report.description!,
      incidentDate: report.incidentDate!.toISOString(),
      createdAt: report.createdAt!.toISOString(),
      anonymous: Boolean(report.anonymous),
    };
    // Misma regla que en `findOne`: la Policía no recibe al denunciante, y un
    // reporte anónimo no lo revela a nadie.
    if (isModerator(user) && !report.anonymous) {
      const reporter = await this.users.findById(report.ownerId!);
      if (reporter) dto.reporter = ReporterDto.fromEntity(reporter);
    }
    dto.urls = urls.map((u) => ({
      url: u.url,
      riskLevel: u.riskLevel,
      certificateStatus: u.certificateStatus,
      lastEvaluatedAt: u.lastEvaluatedAt?.toISOString(),
    }));
    dto.evidence = await Promise.all(
      evidence.map(async (e) => ({
        fileName: e.fileName,
        path: `/reports/${report.id}/evidence/${e.fileName}`,
        mimeType: e.mimeType,
        uploadedAt: e.uploadedAt.toISOString(),
        sha256: await sha256(e.fileName),
      })),
    );
    dto.history = history.map((h) => ReportHistoryDto.fromEntity(h));
    await this.audit.log('REPORTE_EXPORTADO', {
      userId: user.sub,
      detail: `reporte ${id}`,
      ip,
    });
    return dto;
  }

  /**
   * Asocia al reporte un archivo de evidencia (JPEG o PDF). Solo mientras el
   * reporte siga en RECIBIDO: una vez en revisión o validado, la evidencia
   * es parte del expediente y ya no se toca.
   *
   * @param user - Payload del access token.
   * @param id - `id_reporte`.
   * @param file - Archivo recibido en memoria; `file.buffer` es su contenido.
   * @throws {@link NotFoundException} si el reporte no existe o no es del
   * usuario del token.
   * @throws {@link ConflictException} si el reporte ya no está en RECIBIDO.
   * @throws {@link BadRequestException} si ya tiene el máximo de archivos.
   */
  async addEvidence(
    user: JwtPayload,
    id: number,
    file: Express.Multer.File,
  ): Promise<ReportResponseDto> {
    const report = await this.findEditable(user, id);
    if (report.evidence!.length >= MAX_EVIDENCE) {
      throw new BadRequestException(
        `Máximo ${MAX_EVIDENCE} archivos de evidencia por reporte.`,
      );
    }
    // El contenido real decide el tipo (JPEG o PDF); se guarda cifrado y con
    // nombre aleatorio.
    const stored = await storeUpload(UPLOADS_DIR, file.buffer, [
      'image/jpeg',
      'application/pdf',
    ]);
    try {
      // El repositorio vuelve a comprobar estado y tope con la fila bloqueada.
      const updated = (await this.repository.addEvidence(
        id,
        stored.fileName,
        stored.mimeType,
        MAX_EVIDENCE,
      ))!;
      return ReportResponseDto.fromEntity(updated, 'Evidencia agregada');
    } catch (err) {
      // Sin registro en la base el archivo quedaría huérfano en disco.
      await removeStored(UPLOADS_DIR, [stored.fileName]);
      throw err;
    }
  }

  /**
   * Los bytes de una evidencia, descifrados. Solo para quien puede ver el
   * reporte; si no, responde igual que si no existiera.
   * @throws {@link NotFoundException} si no existe o no es de ese reporte.
   */
  async evidenceFile(
    user: JwtPayload,
    id: number,
    fileName: string,
  ): Promise<{ content: Buffer; mimeType: string }> {
    const report = await this.findVisible(user, id);
    const content =
      STORED_FILE_NAME.test(fileName) && report.evidence!.includes(fileName)
        ? await readStored(UPLOADS_DIR, fileName)
        : undefined;
    if (!content) throw new NotFoundException('Evidencia no encontrada');
    return { content, mimeType: mimeOfStored(fileName)! };
  }

  /**
   * Busca un reporte que el rol del token puede ver. Si no puede, responde
   * igual que si no existiera para no revelar que existe.
   */
  private async findVisible(user: JwtPayload, id: number): Promise<Report> {
    const report = await this.repository.findById(id);
    const visible =
      report &&
      (user.role === ROLES.ADMIN ||
        user.role === ROLES.OWNER ||
        (user.role === ROLES.USER && report.ownerId === user.sub) ||
        (user.role === ROLES.POLICE &&
          POLICE_VISIBLE_STATUSES.includes(report.status!)));
    if (!visible) {
      throw new NotFoundException('Reporte ' + id + ' no encontrado');
    }
    return report;
  }

  /**
   * Busca un reporte propio que todavía se puede editar o borrar: solo
   * mientras nadie lo ha empezado a revisar (CU06, CU07).
   */
  private async findEditable(user: JwtPayload, id: number): Promise<Report> {
    const report = await this.repository.findById(id);
    if (!report || report.ownerId !== user.sub) {
      throw new NotFoundException('Reporte ' + id + ' no encontrado');
    }
    if (report.status !== 'RECIBIDO') {
      throw new ConflictException(
        'El reporte ya está en ' + report.status + ' y no se puede modificar',
      );
    }
    return report;
  }
}

/** Administrador y Owner moderan los reportes. */
function isModerator(user: JwtPayload): boolean {
  return user.role === ROLES.ADMIN || user.role === ROLES.OWNER;
}

/**
 * Folio del expediente: `ZS-<año de creación>-<id_reporte a 6 dígitos>`.
 */
function folio(report: Report): string {
  const year = report.createdAt!.getFullYear();
  return `ZS-${year}-${String(report.id).padStart(6, '0')}`;
}

/**
 * Huella SHA-256 de un archivo de evidencia. Quien recibe el expediente
 * puede recalcularla sobre el archivo y comprobar que es el mismo.
 *
 * @param fileName - Nombre del archivo dentro de `uploads/`.
 * @returns El hash en hexadecimal, o `undefined` si el archivo ya no está.
 */
async function sha256(fileName: string): Promise<string | undefined> {
  // Se calcula sobre el contenido ya descifrado: es la huella del archivo
  // original, la que se puede recalcular fuera del servidor.
  const content = await readStored(UPLOADS_DIR, fileName);
  return content
    ? createHash('sha256').update(content).digest('hex')
    : undefined;
}

/**
 * Valida que la fecha del incidente no sea futura (diccionario de datos:
 * "debe ser menor o igual a fecha actual").
 */
function checkIncidentDate(value: string): Date {
  const date = new Date(value);
  if (date > new Date()) {
    throw new BadRequestException('incidentDate no puede ser posterior a hoy');
  }
  return date;
}

/**
 * Corre `work` y traduce el error de llave foránea de TipoFraude a un 400.
 */
async function withFraudTypeCheck<T>(
  fraudTypeId: number | undefined,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    // La llave foránea a TipoFraude es la que valida el tipo.
    if (err?.code === 'ER_NO_REFERENCED_ROW_2') {
      throw new BadRequestException(
        'Tipo de fraude ' + fraudTypeId + ' no existe',
      );
    }
    throw err;
  }
}

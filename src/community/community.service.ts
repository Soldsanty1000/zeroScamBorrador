import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountRepository, Profile } from '../account/account.repository';
import { AccountService, isStaff } from '../account/account.service';
import { AccountResponseDto } from '../account/dto/account.dto';
import { DELETED_STATUS } from '../account/account.repository';
import { AnalyticsService } from '../analytics/analytics.service';
import { POLICE_VISIBLE_STATUSES } from '../common/constants';
import {
  readStored,
  removeStored,
  storeUpload,
  UPLOADS_DIR,
} from '../common/files';
import {
  CommentRow,
  CommunityReport,
  CommunityRepository,
  Person,
  ReportInput,
} from './community.repository';
import {
  CategoryDto,
  CommentResponseDto,
  CommunityFiltersDto,
  CommunityReportDto,
  CommunityStatsDto,
  HistoryEntryDto,
  PublicProfileDto,
  SaveCommunityReportDto,
  UpdateCommunityReportDto,
} from './dto/community.dto';

const REPORTS_PER_DAY = 10;
const COMMENTS_PER_MINUTE = 5;
const MAX_EVIDENCE = 3;
/** El autor puede editar mientras nadie lo haya validado ni cerrado. */
const EDITABLE_STATUSES = ['RECIBIDO', 'EN_REVISION'];
const RISK_ORDER = ['NO_EVALUADO', 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO'];

/**
 * Lo que la app de iOS hace con los reportes: verlos como comunidad,
 * crearlos con su formulario, guardarlos, confirmarlos y comentarlos.
 *
 * Lo que alguien no puede ver responde igual que lo que no existe (404),
 * para no confirmar que existe.
 */
@Injectable()
export class CommunityService {
  constructor(
    private readonly repository: CommunityRepository,
    private readonly accounts: AccountService,
    private readonly accountsRepository: AccountRepository,
    private readonly analytics: AnalyticsService,
  ) {}

  // ---------- Listas y detalle ----------

  async list(
    userId: string,
    filters: CommunityFiltersDto,
  ): Promise<CommunityReportDto[]> {
    const me = await this.accounts.requireActive(userId);
    const scope = filters.scope ?? 'feed';
    if (scope === 'queue' && !isStaff(me)) {
      throw new ForbiddenException('Tu rol no tiene acceso a esta ruta');
    }
    let reports = await this.repository.list(me.id, scope, filters.status);
    // Un guardado que dejó de ser visible (lo rechazaron) ya no se muestra.
    if (scope === 'saved') reports = reports.filter((r) => canSee(r, me));
    if (scope === 'feed' && (filters.q || filters.types || filters.minRisk)) {
      reports = reports.filter((r) => matches(r, filters));
      await this.analytics.count('busqueda', me.id);
    }
    return reports.map((r) => toView(r, me));
  }

  async findOne(userId: string, id: number): Promise<CommunityReportDto> {
    const me = await this.accounts.requireActive(userId);
    return toView(await this.visible(me, id), me);
  }

  /**
   * Perfil público de quien firmó un reporte: alias, biografía, si tiene
   * avatar y sus reportes públicos no anónimos. Nunca el correo, el nombre
   * real ni el país.
   *
   * @throws {@link NotFoundException} si la cuenta no existe, se eliminó, o no
   * tiene perfil público y quien pide no es ella misma ni modera.
   */
  async publicProfile(userId: string, id: number): Promise<PublicProfileDto> {
    const me = await this.accounts.requireActive(userId);
    const owner = await this.accountsRepository.findById(id);
    const visible =
      owner &&
      owner.accountStatus !== DELETED_STATUS &&
      (owner.id === me.id || isStaff(me) || owner.preferences.publicProfile);
    if (!visible) throw new NotFoundException('Perfil no encontrado');
    const reports = await this.repository.listSignedBy(me.id, owner.id);
    return {
      id: String(owner.id),
      alias: owner.alias,
      bio: owner.bio,
      hasAvatar: Boolean(owner.avatarFile),
      memberSince: owner.createdAt.toISOString(),
      reports: reports.map((r) => toView(r, me)),
    };
  }

  // ---------- Crear, editar, eliminar ----------

  async create(
    userId: string,
    dto: SaveCommunityReportDto,
  ): Promise<CommunityReportDto> {
    const me = await this.accounts.requireActive(userId);
    const input = await this.toInput(dto);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (
      (await this.repository.countReportsSince(me.id, dayAgo)) >=
      REPORTS_PER_DAY
    ) {
      throw tooMany(
        `Llegaste al límite de ${REPORTS_PER_DAY} reportes por día. Intenta mañana.`,
      );
    }
    const id = await this.repository.create(me.id, input);
    await this.analytics.count('reporte_enviado', me.id);
    return toView((await this.repository.findById(me.id, id))!, me);
  }

  async update(
    userId: string,
    id: number,
    dto: UpdateCommunityReportDto,
  ): Promise<CommunityReportDto> {
    const me = await this.accounts.requireActive(userId);
    const report = await this.editable(me, id);
    const input = await this.toInput(dto);
    const remove = dto.removeEvidenceIds ?? [];
    const files = await this.repository.update(report.id, input, remove);
    await removeStored(UPLOADS_DIR, files);
    return toView((await this.repository.findById(me.id, id))!, me);
  }

  /** El autor borra el suyo; quien modera, cualquiera. */
  async remove(userId: string, id: number): Promise<void> {
    const me = await this.accounts.requireActive(userId);
    const report = await this.visible(me, id);
    if (report.author.id !== me.id && !isStaff(me)) {
      throw new ForbiddenException('No tienes permiso para hacer esto');
    }
    await removeStored(UPLOADS_DIR, await this.repository.delete(id));
  }

  /** Adjunta una evidencia (JPEG o PDF) a un reporte propio aún editable. */
  async addEvidence(
    userId: string,
    id: number,
    content: Buffer,
  ): Promise<CommunityReportDto> {
    const me = await this.accounts.requireActive(userId);
    const report = await this.editable(me, id);
    if (report.evidence.length >= MAX_EVIDENCE) {
      throw new BadRequestException(
        `Máximo ${MAX_EVIDENCE} archivos de evidencia.`,
      );
    }
    const stored = await storeUpload(UPLOADS_DIR, content, [
      'image/jpeg',
      'application/pdf',
    ]);
    await this.repository.addEvidence(id, stored.fileName, stored.mimeType);
    return toView((await this.repository.findById(me.id, id))!, me);
  }

  /** Los bytes de una evidencia: solo para el autor del reporte y quien modera. */
  async evidence(
    userId: string,
    evidenceId: number,
  ): Promise<{ content: Buffer; mimeType: string }> {
    const me = await this.accounts.requireActive(userId);
    const row = await this.repository.findEvidence(evidenceId);
    const content =
      row && (row.ownerId === me.id || isStaff(me))
        ? await readStored(UPLOADS_DIR, row.fileName)
        : undefined;
    if (!row || !content)
      throw new NotFoundException('Evidencia no encontrada');
    return { content, mimeType: row.mimeType };
  }

  // ---------- Guardar y "Yo también" ----------

  async setSaved(userId: string, id: number, saved: boolean): Promise<void> {
    const me = await this.accounts.requireActive(userId);
    await this.visible(me, id);
    await this.repository.setSaved(me.id, id, saved);
  }

  async confirm(userId: string, id: number): Promise<CommunityReportDto> {
    const me = await this.accounts.requireActive(userId);
    const report = await this.repository.findById(me.id, id);
    if (!report || !isPublic(report)) throw notFound(id);
    if (report.author.id === me.id) {
      throw new ConflictException('No puedes confirmar tu propio reporte.');
    }
    await this.repository.confirm(me.id, id);
    return toView((await this.repository.findById(me.id, id))!, me);
  }

  // ---------- Comentarios ----------

  async comments(userId: string, id: number): Promise<CommentResponseDto[]> {
    const me = await this.accounts.requireActive(userId);
    await this.visible(me, id);
    return (await this.repository.comments(id)).map((c) => toComment(c, me));
  }

  async comment(
    userId: string,
    id: number,
    text: string,
  ): Promise<CommentResponseDto> {
    const me = await this.accounts.requireActive(userId);
    const report = await this.visible(me, id);
    if (!isPublic(report)) {
      throw new ConflictException(
        'Solo se puede comentar en reportes validados.',
      );
    }
    const minuteAgo = new Date(Date.now() - 60 * 1000);
    if (
      (await this.repository.countCommentsSince(me.id, minuteAgo)) >=
      COMMENTS_PER_MINUTE
    ) {
      throw tooMany('Espera un momento antes de volver a comentar.');
    }
    const created = await this.repository.addComment(id, me.id, text.trim());
    if (
      report.author.id !== me.id &&
      report.author.accountStatus !== DELETED_STATUS
    ) {
      await this.repository.notify(
        report.author.id,
        id,
        `Nuevo comentario en tu reporte «${titleOf(report)}».`,
      );
    }
    return toComment(created, me);
  }

  /** El autor borra el suyo; quien modera, cualquiera. */
  async removeComment(userId: string, commentId: number): Promise<void> {
    const me = await this.accounts.requireActive(userId);
    const comment = await this.repository.findComment(commentId);
    if (!comment) throw new NotFoundException('Comentario no encontrado');
    await this.visible(me, comment.reportId);
    if (comment.author.id !== me.id && !isStaff(me)) {
      throw new ForbiddenException('No tienes permiso para hacer esto');
    }
    await this.repository.deleteComment(commentId);
  }

  // ---------- Historial y números ----------

  /**
   * Cambios de estado de un reporte, para su autor y quien modera. El autor
   * ve "Equipo de moderación" en vez de quién lo moderó.
   */
  async history(userId: string, id: number): Promise<HistoryEntryDto[]> {
    const me = await this.accounts.requireActive(userId);
    const report = await this.visible(me, id);
    if (report.author.id !== me.id && !isStaff(me)) {
      throw new ForbiddenException('No tienes permiso para hacer esto');
    }
    return (await this.repository.history(id)).map((h) => ({
      id: h.id,
      reportId: id,
      responsible:
        h.fromStatus === undefined || isStaff(me)
          ? visibleName(h.responsible, me)
          : 'Equipo de moderación',
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      observations: h.observations,
      changedAt: h.changedAt.toISOString(),
    }));
  }

  async stats(userId: string): Promise<CommunityStatsDto> {
    await this.accounts.requireActive(userId);
    const s = await this.repository.stats();
    return {
      peopleHelped: s.confirmations + s.saved,
      verifiedReports: s.verified,
      scamsStopped: s.channeled,
      zonesCovered: s.zones,
    };
  }

  /** Reportes públicos por tipo de fraude, con el riesgo más alto de cada uno. */
  async categories(userId: string): Promise<CategoryDto[]> {
    await this.accounts.requireActive(userId);
    const byType = new Map<string, CategoryDto>();
    for (const row of await this.repository.publicByTypeAndRisk()) {
      const entry = byType.get(row.type) ?? {
        fraudType: row.type,
        total: 0,
        maxRisk: RISK_ORDER[0],
      };
      entry.total += row.total;
      if (RISK_ORDER.indexOf(row.risk) > RISK_ORDER.indexOf(entry.maxRisk)) {
        entry.maxRisk = row.risk;
      }
      byType.set(row.type, entry);
    }
    return [...byType.values()];
  }

  /** "Descargar mis datos": todo lo que la base guarda de quien lo pide. */
  async export(userId: string): Promise<Record<string, unknown>> {
    const me = await this.accounts.requireActive(userId);
    const [reports, comments, saved, confirmations, notifications] =
      await Promise.all([
        this.repository.list(me.id, 'mine'),
        this.repository.commentsBy(me.id),
        this.repository.savedIds(me.id),
        this.repository.confirmedIds(me.id),
        this.repository.notifications(me.id),
      ]);
    return {
      generatedAt: new Date().toISOString(),
      account: AccountResponseDto.fromProfile(me),
      reports: reports.map((r) => toView(r, me)),
      comments: comments.map((c) => toComment(c, me)),
      saved,
      confirmations,
      notifications: notifications.map((n) => ({
        ...n,
        sentAt: n.sentAt.toISOString(),
      })),
    };
  }

  // ---------- Ayudantes ----------

  private async visible(me: Profile, id: number): Promise<CommunityReport> {
    const report = await this.repository.findById(me.id, id);
    if (!report || !canSee(report, me)) throw notFound(id);
    return report;
  }

  /** Un reporte propio que todavía se puede editar. */
  private async editable(me: Profile, id: number): Promise<CommunityReport> {
    const report = await this.repository.findById(me.id, id);
    if (!report || report.author.id !== me.id) throw notFound(id);
    if (!EDITABLE_STATUSES.includes(report.status)) {
      throw new ConflictException(
        'Este reporte ya fue revisado y no se puede editar.',
      );
    }
    return report;
  }

  private async toInput(dto: SaveCommunityReportDto): Promise<ReportInput> {
    const fraudTypeId = await this.repository.fraudTypeId(dto.fraudType);
    if (!fraudTypeId) {
      throw new BadRequestException(
        'Tipo de fraude ' + dto.fraudType + ' no existe',
      );
    }
    const incidentDate = new Date(dto.incidentDate);
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    // Unos minutos de margen: el reloj del teléfono puede ir adelantado al
    // del servidor y la app manda "ahora" por defecto.
    const latest = new Date(Date.now() + 5 * 60 * 1000);
    if (incidentDate > latest || incidentDate < yearAgo) {
      throw new BadRequestException(
        'La fecha no puede ser futura ni de hace más de un año.',
      );
    }
    return {
      fraudTypeId,
      otherType: dto.fraudType === 'Otro' ? dto.otherType?.trim() : undefined,
      title: dto.title.trim(),
      description: dto.description.trim(),
      incidentDate,
      anonymous: dto.anonymous,
      affected: dto.affected,
      affectedPerson:
        dto.affected === 'OTRA_PERSONA' ? dto.affectedPerson : undefined,
      city: dto.city.trim(),
      url: dto.url,
      // Con enlace, el texto libre no se guarda: la app captura uno u otro.
      suspiciousText: dto.url
        ? undefined
        : dto.suspiciousText?.trim() || undefined,
    };
  }
}

function notFound(id: number): NotFoundException {
  return new NotFoundException('Reporte ' + id + ' no encontrado');
}

function tooMany(message: string): HttpException {
  return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
}

function isPublic(report: CommunityReport): boolean {
  return POLICE_VISIBLE_STATUSES.includes(report.status);
}

function canSee(report: CommunityReport, me: Profile): boolean {
  return isPublic(report) || report.author.id === me.id || isStaff(me);
}

function titleOf(report: CommunityReport): string {
  return report.title ?? report.fraudType;
}

/** Nombre con el que `me` ve a otra persona, según su perfil público. */
function visibleName(person: Person, me: Profile): string {
  if (person.accountStatus === DELETED_STATUS) return 'Cuenta eliminada';
  if (person.id === me.id) return 'Tú';
  return person.publicProfile || isStaff(me)
    ? person.alias
    : 'Miembro de la comunidad';
}

/**
 * Arma el reporte para `me`: autor anónimo o privado oculto; persona
 * afectada y evidencia solo para el autor y quien modera.
 */
function toView(report: CommunityReport, me: Profile): CommunityReportDto {
  const mine = report.author.id === me.id;
  const privileged = mine || isStaff(me);
  const author = report.author;
  const deleted = author.accountStatus === DELETED_STATUS;
  let name: string;
  if (deleted) {
    name = 'Cuenta eliminada';
  } else if (report.anonymous) {
    name = mine
      ? 'Tú (anónimo)'
      : isStaff(me)
        ? `${author.alias} (anónimo)`
        : 'Anónimo';
  } else {
    name = visibleName(author, me);
  }
  const showsId =
    !deleted && (privileged || (!report.anonymous && author.publicProfile));
  return {
    id: report.id,
    author: { userId: showsId ? String(author.id) : undefined, name },
    fraudType: report.fraudType,
    otherType: report.otherType,
    status: report.status,
    title: titleOf(report),
    description: report.description,
    incidentDate: report.incidentDate.toISOString(),
    riskLevel: report.riskLevel,
    createdAt: report.createdAt.toISOString(),
    anonymous: report.anonymous,
    affected: report.affected,
    city: report.city ?? '',
    affectedPerson: privileged ? report.affectedPerson : undefined,
    site: report.site && {
      ...report.site,
      lastEvaluatedAt: report.site.lastEvaluatedAt?.toISOString(),
    },
    suspiciousText: report.suspiciousText,
    evidence: privileged
      ? report.evidence.map((e) => ({
          id: e.id,
          mimeType: e.mimeType,
          uploadedAt: e.uploadedAt.toISOString(),
        }))
      : [],
    evidenceCount: report.evidence.length,
    confirmations: report.confirmations,
    comments: report.comments,
    confirmedByMe: report.confirmedByViewer,
    savedByMe: report.savedByViewer,
    mine,
  };
}

function toComment(comment: CommentRow, me: Profile): CommentResponseDto {
  return {
    id: comment.id,
    reportId: comment.reportId,
    author: visibleName(comment.author, me),
    mine: comment.author.id === me.id,
    text: comment.text,
    createdAt: comment.createdAt.toISOString(),
  };
}

/** Sin mayúsculas ni acentos, para comparar texto de búsqueda. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Filtro de Buscar: tipos, riesgo mínimo y texto. Todas las palabras deben
 * aparecer en el título, la descripción, el tipo, la ciudad, la URL o el
 * texto sospechoso.
 */
function matches(
  report: CommunityReport,
  filters: CommunityFiltersDto,
): boolean {
  if (filters.types) {
    const types = filters.types.split(',').map((t) => t.trim());
    if (!types.includes(report.fraudType)) return false;
  }
  if (
    filters.minRisk &&
    RISK_ORDER.indexOf(report.riskLevel) < RISK_ORDER.indexOf(filters.minRisk)
  ) {
    return false;
  }
  const words = normalize(filters.q ?? '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(
    [
      titleOf(report),
      report.description,
      report.otherType ?? report.fraudType,
      report.city ?? '',
      report.site?.url ?? '',
      report.suspiciousText ?? '',
    ].join(' '),
  );
  return words.every((w) => haystack.includes(w));
}

import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt';
import { POLICE_VISIBLE_STATUSES, ROLES } from '../common/constants';
import { SiteStatsQueryDto } from './dto/site-stats-query.dto';
import { SiteStatsResponseDto } from './dto/site-stats-response.dto';
import { StatsQueryDto } from './dto/stats-query.dto';
import { StatsResponseDto } from './dto/stats-response.dto';
import {
  DateRange,
  rangeClause,
  StatsFilters,
  StatsRepository,
} from './stats.repository';

/**
 * Estadísticas de reportes para detectar patrones (CU12, CU21) y métricas
 * de uso de la plataforma.
 */
@Injectable()
export class StatsService {
  constructor(private readonly repository: StatsRepository) {}

  /**
   * Conteos por estado, tipo de fraude, riesgo, país y mes.
   *
   * @param user - Payload del access token. La Policía solo cuenta reportes
   * VALIDADO o CANALIZADO, igual que en `GET /reports`.
   * @param query - Filtros opcionales.
   */
  async summary(
    user: JwtPayload,
    query: StatsQueryDto,
  ): Promise<StatsResponseDto> {
    const filters: StatsFilters = {
      statuses:
        user.role === ROLES.POLICE ? POLICE_VISIBLE_STATUSES : undefined,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      country: query.country,
      riskLevel: query.riskLevel,
    };
    const [byStatus, byFraudType, byRiskLevel, byCountry, byMonth] =
      await Promise.all([
        this.repository.countBy('e.nombre_estado', filters),
        this.repository.countBy('t.nombre_tipo', filters),
        this.repository.countBy('r.nivel_riesgo_asignado', filters),
        this.repository.countBy('u.pais', filters),
        this.repository.countBy(
          "DATE_FORMAT(r.fecha_creacion, '%Y-%m')",
          filters,
        ),
      ]);
    const count = (name: string) =>
      byStatus.find((s) => s.name === name)?.count ?? 0;
    // Aceptados: VALIDADO y CANALIZADO (canalizar implica haberlo validado).
    const accepted = count('VALIDADO') + count('CANALIZADO');
    const resolved = accepted + count('RECHAZADO');
    return {
      total: byStatus.reduce((sum, s) => sum + s.count, 0),
      byStatus,
      byFraudType,
      byRiskLevel,
      byCountry,
      byMonth: byMonth.sort((a, b) => a.name.localeCompare(b.name)),
      approvalRate: resolved > 0 ? accepted / resolved : null,
    };
  }

  /**
   * Métricas de uso de la plataforma: cuentas, directorio de URLs,
   * consultas de riesgo y notificaciones (SRS, Administrador RF06).
   *
   * @param query - Periodo opcional. Se aplica a la fecha de registro de
   * las cuentas, de consulta y de envío de las notificaciones; el
   * directorio de URLs es su estado actual y no depende del periodo.
   */
  async site(query: SiteStatsQueryDto): Promise<SiteStatsResponseDto> {
    const range: DateRange = {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    };
    const users = 'Usuario u JOIN Rol r ON r.id_rol = u.id_rol';
    const registered = 'u.fecha_registro';
    const lookedUp = rangeClause('fecha_consulta', range);
    const sent = rangeClause('fecha_envio', range);
    const [
      byRole,
      byAccountStatus,
      byCountry,
      usersByMonth,
      urlsByRiskLevel,
      analyzedUrls,
      lookups,
      lookupUsers,
      lookupsByMonth,
      notifications,
      unread,
      riskAlerts,
    ] = await Promise.all([
      this.repository.countGrouped(users, 'r.nombre_rol', registered, range),
      this.repository.countGrouped(users, 'u.estado_cuenta', registered, range),
      this.repository.countGrouped(users, 'u.pais', registered, range),
      this.repository.countGrouped(
        users,
        "DATE_FORMAT(u.fecha_registro, '%Y-%m')",
        registered,
        range,
      ),
      // Sin periodo: `SitioWeb_URL` no guarda cuándo se dio de alta la URL.
      this.repository.countGrouped(
        'SitioWeb_URL',
        'nivel_riesgo_global',
        'fecha_ultima_evaluacion',
        {},
      ),
      this.repository.count(
        'SitioWeb_URL',
        'COUNT(*)',
        'fecha_ultima_evaluacion IS NOT NULL',
      ),
      this.repository.count('Consulta_URL', 'COUNT(*)', lookedUp),
      this.repository.count(
        'Consulta_URL',
        'COUNT(DISTINCT id_usuario)',
        lookedUp,
      ),
      this.repository.countGrouped(
        'Consulta_URL',
        "DATE_FORMAT(fecha_consulta, '%Y-%m')",
        'fecha_consulta',
        range,
      ),
      this.repository.count('Notificacion_Alerta', 'COUNT(*)', sent),
      this.repository.count(
        'Notificacion_Alerta',
        'COUNT(*)',
        sent + ' AND leido_estatus = FALSE',
      ),
      this.repository.count(
        'Notificacion_Alerta',
        'COUNT(*)',
        sent + ' AND id_url IS NOT NULL',
      ),
    ]);
    const total = (counts: { count: number }[]) =>
      counts.reduce((sum, c) => sum + c.count, 0);
    const chronological = (counts: { name: string; count: number }[]) =>
      counts.sort((a, b) => a.name.localeCompare(b.name));
    return {
      users: {
        total: total(byRole),
        byRole,
        byAccountStatus,
        byCountry,
        byMonth: chronological(usersByMonth),
      },
      urls: {
        total: total(urlsByRiskLevel),
        analyzed: analyzedUrls,
        byRiskLevel: urlsByRiskLevel,
      },
      lookups: {
        total: lookups,
        users: lookupUsers,
        byMonth: chronological(lookupsByMonth),
      },
      notifications: { total: notifications, unread, riskAlerts },
    };
  }
}

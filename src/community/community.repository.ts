/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Inject, Injectable } from '@nestjs/common';
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';

const PUBLIC = "('VALIDADO', 'CANALIZADO')";

// Los dos `?` son el id de quien mira: marcan "confirmado por mí" y "guardado por mí".
const COLUMNS = `r.id_reporte, r.id_usuario, t.nombre_tipo, e.nombre_estado, r.titulo,
  r.descripcion_incidente, r.fecha_incidente, r.nivel_riesgo_asignado, r.fecha_creacion,
  r.es_anonimo, r.afectado, r.ciudad, r.tipo_otro, r.texto_sospechoso,
  u.alias AS autor_alias, u.estado_cuenta AS autor_estado, u.pref_perfil_publico AS autor_publico,
  (SELECT COUNT(*) FROM Reporte_Confirmacion c WHERE c.id_reporte = r.id_reporte) AS confirmaciones,
  (SELECT COUNT(*) FROM Comentario c WHERE c.id_reporte = r.id_reporte) AS comentarios,
  EXISTS(SELECT 1 FROM Reporte_Confirmacion c WHERE c.id_reporte = r.id_reporte AND c.id_usuario = ?) AS confirmado,
  EXISTS(SELECT 1 FROM Reporte_Guardado g WHERE g.id_reporte = r.id_reporte AND g.id_usuario = ?) AS guardado`;

const FROM = `Reporte r JOIN Estado e ON e.id_estado = r.id_estado
  JOIN TipoFraude t ON t.id_tipo_fraude = r.id_tipo_fraude
  JOIN Usuario u ON u.id_usuario = r.id_usuario`;

/** Quien firma un reporte, un comentario o un cambio de estado. */
export interface Person {
  id: number;
  alias: string;
  accountStatus: string;
  publicProfile: boolean;
}

export interface SiteRow {
  id: number;
  url: string;
  riskLevel: string;
  certificateStatus: string | undefined;
  lastEvaluatedAt: Date | undefined;
}

export interface EvidenceRow {
  id: number;
  reportId: number;
  fileName: string;
  mimeType: string;
  uploadedAt: Date;
}

export interface AffectedPerson {
  name: string;
  contact: string;
  authorized: boolean;
}

/** Un reporte con todo lo que guarda la base, antes de decidir qué ve cada quien. */
export interface CommunityReport {
  id: number;
  author: Person;
  fraudType: string;
  otherType: string | undefined;
  status: string;
  title: string | undefined;
  description: string;
  incidentDate: Date;
  riskLevel: string;
  createdAt: Date;
  anonymous: boolean;
  affected: string;
  city: string | undefined;
  suspiciousText: string | undefined;
  confirmations: number;
  comments: number;
  confirmedByViewer: boolean;
  savedByViewer: boolean;
  site: SiteRow | undefined;
  evidence: EvidenceRow[];
  affectedPerson: AffectedPerson | undefined;
}

export interface CommentRow {
  id: number;
  reportId: number;
  author: Person;
  text: string;
  createdAt: Date;
}

export interface HistoryRow {
  id: number;
  responsible: Person;
  fromStatus: string | undefined;
  toStatus: string;
  observations: string | undefined;
  changedAt: Date;
}

/** Lo que escribe el formulario de la app. */
export interface ReportInput {
  fraudTypeId: number;
  otherType: string | undefined;
  title: string;
  description: string;
  incidentDate: Date;
  anonymous: boolean;
  affected: string;
  affectedPerson: AffectedPerson | undefined;
  city: string;
  url: string | undefined;
  suspiciousText: string | undefined;
}

export type Scope = 'feed' | 'mine' | 'saved' | 'queue';

/**
 * SQL de lo que la app de iOS agrega sobre los reportes: vista comunitaria,
 * guardados, "Yo también", comentarios y estadísticas. Todas las consultas
 * van con parámetros.
 */
@Injectable()
export class CommunityRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async findById(
    viewerId: number,
    id: number,
  ): Promise<CommunityReport | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE r.id_reporte = ?`,
      [viewerId, viewerId, id],
    );
    return (await this.withRelations(rows))[0];
  }

  /**
   * Lista reportes según la pantalla que los pide.
   *
   * @param scope - `feed`: los públicos. `mine`: los de quien mira. `saved`:
   * sus guardados. `queue`: la cola de moderación.
   * @param status - Solo para `queue`; sin él, RECIBIDO y EN_REVISION.
   */
  async list(
    viewerId: number,
    scope: Scope,
    status?: string,
  ): Promise<CommunityReport[]> {
    const params: unknown[] = [viewerId, viewerId];
    let sql = `SELECT ${COLUMNS} FROM ${FROM}`;
    if (scope === 'feed') {
      sql += ` WHERE e.nombre_estado IN ${PUBLIC} ORDER BY r.fecha_creacion DESC, r.id_reporte DESC`;
    } else if (scope === 'mine') {
      sql +=
        ' WHERE r.id_usuario = ? ORDER BY r.fecha_creacion DESC, r.id_reporte DESC';
      params.push(viewerId);
    } else if (scope === 'saved') {
      sql += ` JOIN Reporte_Guardado sg ON sg.id_reporte = r.id_reporte AND sg.id_usuario = ?
               ORDER BY sg.fecha DESC, r.id_reporte DESC`;
      params.push(viewerId);
    } else {
      sql += status
        ? ' WHERE e.nombre_estado = ?'
        : " WHERE e.nombre_estado IN ('RECIBIDO', 'EN_REVISION')";
      if (status) params.push(status);
      sql += ' ORDER BY r.fecha_creacion, r.id_reporte';
    }
    const [rows] = await this.pool.query<RowDataPacket[]>(sql, params);
    return this.withRelations(rows);
  }

  /**
   * Reportes que una persona firmó con su nombre: públicos y no anónimos,
   * del más reciente al más antiguo. Es lo que muestra su perfil público.
   */
  async listSignedBy(
    viewerId: number,
    authorId: number,
  ): Promise<CommunityReport[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM ${FROM}
       WHERE r.id_usuario = ? AND r.es_anonimo = FALSE AND e.nombre_estado IN ${PUBLIC}
       ORDER BY r.fecha_creacion DESC, r.id_reporte DESC`,
      [viewerId, viewerId, authorId],
    );
    return this.withRelations(rows);
  }

  /** `id_tipo_fraude` de un tipo por su nombre; `undefined` si no existe. */
  async fraudTypeId(name: string): Promise<number | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT id_tipo_fraude FROM TipoFraude WHERE nombre_tipo = ?',
      [name],
    );
    return rows[0]?.id_tipo_fraude;
  }

  async countReportsSince(userId: number, since: Date): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM Reporte WHERE id_usuario = ? AND fecha_creacion > ?',
      [userId, since],
    );
    return Number(rows[0].total);
  }

  /**
   * Inserta un reporte en RECIBIDO con su enlace y persona afectada, abre su
   * historial y avisa a quienes moderan (CU16).
   *
   * @returns El `id_reporte` nuevo.
   */
  async create(ownerId: number, input: ReportInput): Promise<number> {
    return this.transaction(async (conn) => {
      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO Reporte (id_usuario, id_tipo_fraude, id_estado, descripcion_incidente,
                              fecha_incidente, titulo, ciudad, es_anonimo, afectado, tipo_otro, texto_sospechoso)
         VALUES (?, ?, (SELECT id_estado FROM Estado WHERE nombre_estado = 'RECIBIDO'), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ownerId,
          input.fraudTypeId,
          input.description,
          input.incidentDate,
          input.title,
          input.city,
          input.anonymous,
          input.affected,
          input.otherType ?? null,
          input.suspiciousText ?? null,
        ],
      );
      const id = result.insertId;
      await linkUrl(conn, id, input.url);
      await saveAffectedPerson(conn, id, input.affectedPerson);
      await conn.query(
        `INSERT INTO Historial_Estado (id_reporte, id_admin_responsable, id_estado_anterior, id_estado_nuevo, observaciones)
         VALUES (?, ?, NULL, (SELECT id_estado FROM Estado WHERE nombre_estado = 'RECIBIDO'), 'Reporte creado')`,
        [id, ownerId],
      );
      await conn.query(
        `INSERT INTO Notificacion_Alerta (id_usuario, id_reporte, mensaje)
         SELECT u.id_usuario, ?, ? FROM Usuario u JOIN Rol ro ON ro.id_rol = u.id_rol
         WHERE ro.nombre_rol IN ('Administrador', 'Owner') AND u.estado_cuenta = 'ACTIVO' AND u.id_usuario <> ?`,
        [id, `Nuevo reporte #${id} por revisar`, ownerId],
      );
      return id;
    });
  }

  /**
   * Reemplaza los datos de un reporte y quita las evidencias indicadas.
   *
   * @returns Los archivos (dentro de `uploads/`) de las evidencias quitadas.
   */
  async update(
    id: number,
    input: ReportInput,
    removeEvidenceIds: number[],
  ): Promise<string[]> {
    return this.transaction(async (conn) => {
      await conn.query(
        `UPDATE Reporte SET id_tipo_fraude = ?, descripcion_incidente = ?, fecha_incidente = ?, titulo = ?,
                ciudad = ?, es_anonimo = ?, afectado = ?, tipo_otro = ?, texto_sospechoso = ?
         WHERE id_reporte = ?`,
        [
          input.fraudTypeId,
          input.description,
          input.incidentDate,
          input.title,
          input.city,
          input.anonymous,
          input.affected,
          input.otherType ?? null,
          input.suspiciousText ?? null,
          id,
        ],
      );
      await conn.query('DELETE FROM Reporte_URL WHERE id_reporte = ?', [id]);
      await linkUrl(conn, id, input.url);
      await saveAffectedPerson(conn, id, input.affectedPerson);
      if (removeEvidenceIds.length === 0) return [];
      const [removed] = await conn.query<RowDataPacket[]>(
        'SELECT ruta_archivo FROM Evidencia WHERE id_reporte = ? AND id_evidencia IN (?)',
        [id, removeEvidenceIds],
      );
      await conn.query(
        'DELETE FROM Evidencia WHERE id_reporte = ? AND id_evidencia IN (?)',
        [id, removeEvidenceIds],
      );
      return removed.map((row) => String(row.ruta_archivo));
    });
  }

  /**
   * Borra un reporte y lo que cuelga de él. Los avisos que lo mencionaban se
   * conservan sin el enlace.
   *
   * @returns Los archivos de sus evidencias.
   */
  async delete(id: number): Promise<string[]> {
    return this.transaction(async (conn) => {
      const [files] = await conn.query<RowDataPacket[]>(
        'SELECT ruta_archivo FROM Evidencia WHERE id_reporte = ?',
        [id],
      );
      await conn.query(
        'UPDATE Notificacion_Alerta SET id_reporte = NULL WHERE id_reporte = ?',
        [id],
      );
      // Primero los hijos sin ON DELETE CASCADE.
      for (const table of [
        'Historial_Estado',
        'Evidencia',
        'Reporte_URL',
        'Reporte',
      ]) {
        await conn.query(`DELETE FROM ${table} WHERE id_reporte = ?`, [id]);
      }
      return files.map((row) => String(row.ruta_archivo));
    });
  }

  async addEvidence(
    id: number,
    fileName: string,
    mimeType: string,
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO Evidencia (id_reporte, ruta_archivo, tipo_archivo) VALUES (?, ?, ?)',
      [id, fileName, mimeType],
    );
  }

  /** Una evidencia con el dueño de su reporte, para decidir quién la baja. */
  async findEvidence(
    id: number,
  ): Promise<(EvidenceRow & { ownerId: number }) | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ev.id_evidencia, ev.id_reporte, ev.ruta_archivo, ev.tipo_archivo, ev.fecha_carga, r.id_usuario
       FROM Evidencia ev JOIN Reporte r ON r.id_reporte = ev.id_reporte WHERE ev.id_evidencia = ?`,
      [id],
    );
    return (
      rows[0] && { ...toEvidence(rows[0]), ownerId: Number(rows[0].id_usuario) }
    );
  }

  async setSaved(userId: number, id: number, saved: boolean): Promise<void> {
    await this.pool.query(
      saved
        ? 'INSERT IGNORE INTO Reporte_Guardado (id_usuario, id_reporte) VALUES (?, ?)'
        : 'DELETE FROM Reporte_Guardado WHERE id_usuario = ? AND id_reporte = ?',
      [userId, id],
    );
  }

  async confirm(userId: number, id: number): Promise<void> {
    await this.pool.query(
      'INSERT IGNORE INTO Reporte_Confirmacion (id_usuario, id_reporte) VALUES (?, ?)',
      [userId, id],
    );
  }

  // ---------- Comentarios ----------

  /** Comentarios de un reporte, del más nuevo al más antiguo. */
  async comments(reportId: number): Promise<CommentRow[]> {
    return this.commentsWhere('c.id_reporte = ?', reportId);
  }

  async commentsBy(userId: number): Promise<CommentRow[]> {
    return this.commentsWhere('c.id_usuario = ?', userId);
  }

  async findComment(id: number): Promise<CommentRow | undefined> {
    return (await this.commentsWhere('c.id_comentario = ?', id))[0];
  }

  async countCommentsSince(userId: number, since: Date): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM Comentario WHERE id_usuario = ? AND fecha > ?',
      [userId, since],
    );
    return Number(rows[0].total);
  }

  async addComment(
    reportId: number,
    userId: number,
    text: string,
  ): Promise<CommentRow> {
    const [result] = await this.pool.query<ResultSetHeader>(
      'INSERT INTO Comentario (id_reporte, id_usuario, texto) VALUES (?, ?, ?)',
      [reportId, userId, text],
    );
    return (await this.findComment(result.insertId))!;
  }

  async deleteComment(id: number): Promise<void> {
    await this.pool.query('DELETE FROM Comentario WHERE id_comentario = ?', [
      id,
    ]);
  }

  private async commentsWhere(
    where: string,
    value: number,
  ): Promise<CommentRow[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT c.id_comentario, c.id_reporte, c.texto, c.fecha, c.id_usuario,
              u.alias AS autor_alias, u.estado_cuenta AS autor_estado, u.pref_perfil_publico AS autor_publico
       FROM Comentario c JOIN Usuario u ON u.id_usuario = c.id_usuario
       WHERE ${where} ORDER BY c.fecha DESC, c.id_comentario DESC`,
      [value],
    );
    return rows.map((row) => ({
      id: Number(row.id_comentario),
      reportId: Number(row.id_reporte),
      author: toPerson(row),
      text: row.texto,
      createdAt: row.fecha,
    }));
  }

  // ---------- Historial, avisos y números ----------

  /** Cambios de estado de un reporte, del más antiguo al más nuevo. */
  async history(reportId: number): Promise<HistoryRow[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT h.id_historial, ea.nombre_estado AS anterior, en.nombre_estado AS nuevo, h.observaciones,
              h.fecha_cambio, h.id_admin_responsable AS id_usuario,
              u.alias AS autor_alias, u.estado_cuenta AS autor_estado, u.pref_perfil_publico AS autor_publico
       FROM Historial_Estado h
       LEFT JOIN Estado ea ON ea.id_estado = h.id_estado_anterior
       JOIN Estado en ON en.id_estado = h.id_estado_nuevo
       JOIN Usuario u ON u.id_usuario = h.id_admin_responsable
       WHERE h.id_reporte = ? ORDER BY h.fecha_cambio, h.id_historial`,
      [reportId],
    );
    return rows.map((row) => ({
      id: Number(row.id_historial),
      responsible: toPerson(row),
      fromStatus: row.anterior ?? undefined,
      toStatus: row.nuevo,
      observations: row.observaciones ?? undefined,
      changedAt: row.fecha_cambio,
    }));
  }

  async notify(
    userId: number,
    reportId: number,
    message: string,
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO Notificacion_Alerta (id_usuario, id_reporte, mensaje) VALUES (?, ?, ?)',
      [userId, reportId, message],
    );
  }

  /** Números de la comunidad; solo cuentan los reportes públicos. */
  async stats(): Promise<{
    confirmations: number;
    saved: number;
    verified: number;
    channeled: number;
    zones: number;
  }> {
    const pub = `(SELECT r.id_reporte FROM Reporte r JOIN Estado e ON e.id_estado = r.id_estado
                  WHERE e.nombre_estado IN ${PUBLIC})`;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM Reporte_Confirmacion WHERE id_reporte IN ${pub}) AS confirmations,
         (SELECT COUNT(*) FROM Reporte_Guardado WHERE id_reporte IN ${pub}) AS saved,
         (SELECT COUNT(*) FROM Reporte r JOIN Estado e ON e.id_estado = r.id_estado
           WHERE e.nombre_estado IN ${PUBLIC}) AS verified,
         (SELECT COUNT(*) FROM Reporte r JOIN Estado e ON e.id_estado = r.id_estado
           WHERE e.nombre_estado = 'CANALIZADO') AS channeled,
         (SELECT COUNT(DISTINCT LOWER(TRIM(r.ciudad))) FROM Reporte r JOIN Estado e ON e.id_estado = r.id_estado
           WHERE e.nombre_estado IN ${PUBLIC} AND r.ciudad IS NOT NULL AND TRIM(r.ciudad) <> '') AS zones`,
    );
    const row = rows[0];
    return {
      confirmations: Number(row.confirmations),
      saved: Number(row.saved),
      verified: Number(row.verified),
      channeled: Number(row.channeled),
      zones: Number(row.zones),
    };
  }

  /** Reportes públicos por tipo de fraude y nivel de riesgo. */
  async publicByTypeAndRisk(): Promise<
    { type: string; risk: string; total: number }[]
  > {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT t.nombre_tipo, r.nivel_riesgo_asignado, COUNT(*) AS total
       FROM Reporte r JOIN Estado e ON e.id_estado = r.id_estado
       JOIN TipoFraude t ON t.id_tipo_fraude = r.id_tipo_fraude
       WHERE e.nombre_estado IN ${PUBLIC} GROUP BY t.nombre_tipo, r.nivel_riesgo_asignado`,
    );
    return rows.map((row) => ({
      type: row.nombre_tipo,
      risk: row.nivel_riesgo_asignado,
      total: Number(row.total),
    }));
  }

  // ---------- "Descargar mis datos" ----------

  async savedIds(userId: number): Promise<number[]> {
    return this.ids('Reporte_Guardado', userId);
  }

  async confirmedIds(userId: number): Promise<number[]> {
    return this.ids('Reporte_Confirmacion', userId);
  }

  async notifications(userId: number): Promise<
    {
      id: number;
      reportId: number | undefined;
      message: string;
      read: boolean;
      sentAt: Date;
    }[]
  > {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id_notificacion, id_reporte, mensaje, leido_estatus, fecha_envio FROM Notificacion_Alerta
       WHERE id_usuario = ? ORDER BY fecha_envio DESC, id_notificacion DESC`,
      [userId],
    );
    return rows.map((row) => ({
      id: Number(row.id_notificacion),
      reportId: row.id_reporte ?? undefined,
      message: row.mensaje,
      read: Boolean(row.leido_estatus),
      sentAt: row.fecha_envio,
    }));
  }

  private async ids(table: string, userId: number): Promise<number[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id_reporte FROM ${table} WHERE id_usuario = ? ORDER BY fecha DESC`,
      [userId],
    );
    return rows.map((row) => Number(row.id_reporte));
  }

  // ---------- Ayudantes ----------

  /** Carga enlace, evidencias y persona afectada con una consulta por tabla. */
  private async withRelations(
    rows: RowDataPacket[],
  ): Promise<CommunityReport[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id_reporte);
    const [sites] = await this.pool.query<RowDataPacket[]>(
      `SELECT ru.id_reporte, s.id_url, s.url_texto, s.nivel_riesgo_global, s.estado_certificado, s.fecha_ultima_evaluacion
       FROM Reporte_URL ru JOIN SitioWeb_URL s ON s.id_url = ru.id_url
       WHERE ru.id_reporte IN (?) ORDER BY ru.fecha_asociacion, s.id_url`,
      [ids],
    );
    const [evidence] = await this.pool.query<RowDataPacket[]>(
      `SELECT id_evidencia, id_reporte, ruta_archivo, tipo_archivo, fecha_carga FROM Evidencia
       WHERE id_reporte IN (?) ORDER BY fecha_carga, id_evidencia`,
      [ids],
    );
    const [people] = await this.pool.query<RowDataPacket[]>(
      'SELECT id_reporte, nombre, contacto, autorizo FROM Persona_Afectada WHERE id_reporte IN (?)',
      [ids],
    );
    return rows.map((row) => {
      // La app muestra un solo enlace por reporte: el primero.
      const site = sites.find((s) => s.id_reporte === row.id_reporte);
      const person = people.find((p) => p.id_reporte === row.id_reporte);
      return {
        id: Number(row.id_reporte),
        author: toPerson(row),
        fraudType: row.nombre_tipo,
        otherType: row.tipo_otro ?? undefined,
        status: row.nombre_estado,
        title: row.titulo ?? undefined,
        description: row.descripcion_incidente,
        incidentDate: row.fecha_incidente,
        riskLevel: row.nivel_riesgo_asignado,
        createdAt: row.fecha_creacion,
        anonymous: Boolean(row.es_anonimo),
        affected: row.afectado,
        city: row.ciudad ?? undefined,
        suspiciousText: row.texto_sospechoso ?? undefined,
        confirmations: Number(row.confirmaciones),
        comments: Number(row.comentarios),
        confirmedByViewer: Boolean(row.confirmado),
        savedByViewer: Boolean(row.guardado),
        site: site && {
          id: Number(site.id_url),
          url: site.url_texto,
          riskLevel: site.nivel_riesgo_global,
          certificateStatus: site.estado_certificado ?? undefined,
          lastEvaluatedAt: site.fecha_ultima_evaluacion ?? undefined,
        },
        evidence: evidence
          .filter((ev) => ev.id_reporte === row.id_reporte)
          .map(toEvidence),
        affectedPerson: person && {
          name: person.nombre,
          contact: person.contacto,
          authorized: Boolean(person.autorizo),
        },
      };
    });
  }

  private async transaction<T>(
    work: (conn: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

/** Liga la URL al reporte, creándola en `SitioWeb_URL` si no existía. */
async function linkUrl(
  conn: PoolConnection,
  id: number,
  url: string | undefined,
): Promise<void> {
  if (!url) return;
  const [site] = await conn.query<ResultSetHeader>(
    'INSERT INTO SitioWeb_URL (url_texto) VALUES (?) ON DUPLICATE KEY UPDATE id_url = LAST_INSERT_ID(id_url)',
    [url],
  );
  await conn.query(
    'INSERT INTO Reporte_URL (id_reporte, id_url) VALUES (?, ?)',
    [id, site.insertId],
  );
}

async function saveAffectedPerson(
  conn: PoolConnection,
  id: number,
  person: AffectedPerson | undefined,
): Promise<void> {
  await conn.query('DELETE FROM Persona_Afectada WHERE id_reporte = ?', [id]);
  if (!person) return;
  await conn.query(
    'INSERT INTO Persona_Afectada (id_reporte, nombre, contacto, autorizo) VALUES (?, ?, ?, ?)',
    [id, person.name, person.contact, person.authorized],
  );
}

function toPerson(row: any): Person {
  return {
    id: Number(row.id_usuario),
    alias: row.autor_alias ?? 'usuario' + row.id_usuario,
    accountStatus: row.autor_estado,
    publicProfile: Boolean(row.autor_publico),
  };
}

function toEvidence(row: any): EvidenceRow {
  return {
    id: Number(row.id_evidencia),
    reportId: Number(row.id_reporte),
    fileName: row.ruta_archivo,
    mimeType: row.tipo_archivo,
    uploadedAt: row.fecha_carga,
  };
}

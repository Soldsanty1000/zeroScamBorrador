/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';

const COLUMNS =
  'u.id_usuario, r.nombre_rol, u.nombre, u.apellido, u.pais, u.alias, ' +
  'u.correo_electronico, u.biografia, u.avatar_archivo, u.estado_cuenta, ' +
  'u.fecha_registro, u.fecha_consentimiento, u.version_aviso, ' +
  'u.pref_notificaciones, u.pref_modo_oscuro, u.pref_dos_pasos, ' +
  'u.pref_perfil_publico, u.pref_analiticas';

const FROM = 'Usuario u JOIN Rol r ON r.id_rol = u.id_rol';

/** `Usuario.estado_cuenta` de una cuenta que su dueño eliminó. */
export const DELETED_STATUS = 'ELIMINADA';

export interface Preferences {
  notifications: boolean;
  darkMode: boolean;
  twoStep: boolean;
  publicProfile: boolean;
  analytics: boolean;
}

/** Una fila de `Usuario` con el perfil y las preferencias de la app. */
export interface Profile {
  id: number;
  role: string;
  name: string;
  lastName: string;
  country: string;
  /** El alias guardado o, si no tiene, `usuario<id>`. */
  alias: string;
  email: string;
  bio: string;
  /** Archivo dentro de `storage/avatars/`. */
  avatarFile: string | undefined;
  accountStatus: string;
  createdAt: Date;
  privacyAcceptedAt: Date | undefined;
  privacyVersion: string | undefined;
  preferences: Preferences;
}

/**
 * Acceso a las columnas de `Usuario` que usa la app de iOS: alias, biografía,
 * avatar y preferencias. Todas las consultas van con parámetros.
 */
@Injectable()
export class AccountRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async findById(id: string | number): Promise<Profile | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE u.id_usuario = ?`,
      [id],
    );
    return rows[0] && toProfile(rows[0]);
  }

  /** Todas las cuentas vivas, de la más antigua a la más nueva. */
  async findAll(): Promise<Profile[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE u.estado_cuenta <> ?
       ORDER BY u.fecha_registro, u.id_usuario`,
      [DELETED_STATUS],
    );
    return rows.map(toProfile);
  }

  async passwordHash(id: number): Promise<string | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT contrasena_hash FROM Usuario WHERE id_usuario = ?',
      [id],
    );
    return rows[0]?.contrasena_hash;
  }

  /** Dice si otra cuenta ya usa ese alias (guardado o por defecto). */
  async aliasTaken(alias: string, exceptId?: number): Promise<boolean> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT 1 FROM Usuario
       WHERE (alias = ? OR (alias IS NULL AND CONCAT('usuario', id_usuario) = ?))
         AND id_usuario <> ? LIMIT 1`,
      [alias, alias, exceptId ?? 0],
    );
    return rows.length > 0;
  }

  async emailTaken(email: string, exceptId: number): Promise<boolean> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT 1 FROM Usuario WHERE correo_electronico = ? AND id_usuario <> ? LIMIT 1',
      [email, exceptId],
    );
    return rows.length > 0;
  }

  /** Alias y versión del aviso de una cuenta recién registrada. */
  async completeRegistration(
    id: string,
    alias: string,
    privacyVersion: string,
  ): Promise<void> {
    await this.pool.query(
      'UPDATE Usuario SET alias = ?, version_aviso = ? WHERE id_usuario = ?',
      [alias, privacyVersion, id],
    );
  }

  async updateProfile(
    id: number,
    data: {
      name: string;
      lastName: string;
      country: string;
      alias: string;
      email: string;
      bio: string;
    },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE Usuario SET nombre = ?, apellido = ?, pais = ?, alias = ?,
              correo_electronico = ?, biografia = ? WHERE id_usuario = ?`,
      [
        data.name,
        data.lastName,
        data.country,
        data.alias,
        data.email,
        data.bio,
        id,
      ],
    );
  }

  async updatePreferences(id: number, p: Preferences): Promise<void> {
    await this.pool.query(
      `UPDATE Usuario SET pref_notificaciones = ?, pref_modo_oscuro = ?, pref_dos_pasos = ?,
              pref_perfil_publico = ?, pref_analiticas = ? WHERE id_usuario = ?`,
      [
        p.notifications,
        p.darkMode,
        p.twoStep,
        p.publicProfile,
        p.analytics,
        id,
      ],
    );
  }

  async setAvatar(id: number, file: string | null): Promise<void> {
    await this.pool.query(
      'UPDATE Usuario SET avatar_archivo = ? WHERE id_usuario = ?',
      [file, id],
    );
  }

  /**
   * Derecho de cancelación. Lo público sigue ayudando a la comunidad pero sin
   * rastro de la persona (anónimo, sin persona afectada ni evidencia); lo
   * demás se borra. La fila de `Usuario` se conserva vacía, con estado
   * ELIMINADA, porque historial y comentarios la referencian.
   *
   * @returns Los archivos de evidencia (dentro de `uploads/`) que quedaron sin
   * dueño, para borrarlos del disco.
   */
  async deleteAccount(id: number): Promise<string[]> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [evidence] = await conn.query<RowDataPacket[]>(
        `SELECT e.ruta_archivo FROM Evidencia e
         JOIN Reporte r ON r.id_reporte = e.id_reporte WHERE r.id_usuario = ?`,
        [id],
      );
      const mine = '(SELECT id_reporte FROM Reporte WHERE id_usuario = ?)';
      await conn.query(`DELETE FROM Evidencia WHERE id_reporte IN ${mine}`, [
        id,
      ]);
      await conn.query(
        `DELETE FROM Persona_Afectada WHERE id_reporte IN ${mine}`,
        [id],
      );
      // Los reportes que nunca fueron públicos se van completos. Primero los
      // hijos sin ON DELETE CASCADE; la subconsulta va envuelta porque MySQL
      // no deja borrar de una tabla que se lee en el mismo DELETE.
      const hidden = `(SELECT id_reporte FROM (
          SELECT r.id_reporte FROM Reporte r JOIN Estado e ON e.id_estado = r.id_estado
          WHERE r.id_usuario = ? AND e.nombre_estado NOT IN ('VALIDADO', 'CANALIZADO')) t)`;
      await conn.query(
        `UPDATE Notificacion_Alerta SET id_reporte = NULL WHERE id_reporte IN ${hidden}`,
        [id],
      );
      for (const table of ['Historial_Estado', 'Reporte_URL', 'Reporte']) {
        await conn.query(`DELETE FROM ${table} WHERE id_reporte IN ${hidden}`, [
          id,
        ]);
      }
      await conn.query(
        'UPDATE Reporte SET es_anonimo = TRUE WHERE id_usuario = ?',
        [id],
      );
      for (const table of [
        'Reporte_Guardado',
        'Reporte_Confirmacion',
        'Notificacion_Alerta',
        'Consulta_URL',
        'Desafio_DosPasos',
      ]) {
        await conn.query(`DELETE FROM ${table} WHERE id_usuario = ?`, [id]);
      }
      await conn.query(
        `UPDATE Usuario SET nombre = 'Cuenta', apellido = 'eliminada', pais = '',
                correo_electronico = CONCAT('eliminada-', id_usuario, '@invalid'),
                contrasena_hash = ?, estado_cuenta = ?, alias = NULL, biografia = '',
                avatar_archivo = NULL, fecha_consentimiento = NULL, version_aviso = NULL,
                pref_notificaciones = FALSE, pref_dos_pasos = FALSE, pref_perfil_publico = FALSE
         WHERE id_usuario = ?`,
        // Un hash que no corresponde a ningún password: nadie entra a esta fila.
        ['!' + randomBytes(32).toString('hex'), DELETED_STATUS, id],
      );
      await conn.commit();
      return evidence.map((row) => String(row.ruta_archivo));
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

function toProfile(row: any): Profile {
  return {
    id: Number(row.id_usuario),
    role: row.nombre_rol,
    name: row.nombre,
    lastName: row.apellido,
    country: row.pais,
    alias: row.alias ?? 'usuario' + row.id_usuario,
    email: row.correo_electronico,
    bio: row.biografia,
    avatarFile: row.avatar_archivo ?? undefined,
    accountStatus: row.estado_cuenta,
    createdAt: row.fecha_registro,
    privacyAcceptedAt: row.fecha_consentimiento ?? undefined,
    privacyVersion: row.version_aviso ?? undefined,
    // MySQL guarda BOOLEAN como TINYINT: llega 0 o 1.
    preferences: {
      notifications: Boolean(row.pref_notificaciones),
      darkMode: Boolean(row.pref_modo_oscuro),
      twoStep: Boolean(row.pref_dos_pasos),
      publicProfile: Boolean(row.pref_perfil_publico),
      analytics: Boolean(row.pref_analiticas),
    },
  };
}

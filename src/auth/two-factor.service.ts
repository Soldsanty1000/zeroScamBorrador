import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { MailService } from './mail.service';

const CODE_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 3;

/** Lo que recibe la app cuando el login pide el segundo paso. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeId: string;
  /** Correo enmascarado al que se mandó el código. */
  destination: string;
  /** ISO 8601. */
  expiresAt: string;
}

/**
 * Verificación en dos pasos del login (`Desafio_DosPasos`).
 *
 * El código de 6 dígitos vive 5 minutos y admite 3 intentos. En la base se
 * guarda su hash, no el código. El código se manda al correo registrado por
 * {@link MailService}; si no hay servidor de correo configurado (`SMTP_URL`),
 * se escribe en la consola del servidor.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly mail: MailService,
  ) {}

  /** Dice si la cuenta tiene encendida la verificación en dos pasos. */
  async isEnabled(userId: string): Promise<boolean> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT pref_dos_pasos FROM Usuario WHERE id_usuario = ?',
      [userId],
    );
    return Boolean(rows[0]?.pref_dos_pasos);
  }

  /**
   * Crea un desafío nuevo para el usuario (los anteriores se anulan).
   *
   * @param userId - `id_usuario`.
   * @param email - Correo de la cuenta, para el destino enmascarado.
   */
  async createChallenge(
    userId: string,
    email: string,
  ): Promise<TwoFactorChallenge> {
    const id = randomBytes(32).toString('hex');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expires = new Date(Date.now() + CODE_TTL_SECONDS * 1000);
    await this.pool.query(
      'DELETE FROM Desafio_DosPasos WHERE id_usuario = ? OR expira <= NOW()',
      [userId],
    );
    await this.pool.query(
      'INSERT INTO Desafio_DosPasos (id_desafio, id_usuario, codigo_hash, expira) VALUES (?, ?, ?, ?)',
      [id, userId, sha256(code), expires],
    );
    try {
      await this.mail.sendCode(email, code, CODE_TTL_SECONDS / 60);
    } catch (err) {
      // Un desafío cuyo código nunca llegó no sirve: se retira.
      await this.remove(id);
      throw err;
    }
    return {
      twoFactorRequired: true,
      challengeId: id,
      destination: mask(email),
      expiresAt: expires.toISOString(),
    };
  }

  /**
   * Comprueba el código de un desafío y lo consume.
   *
   * @returns El `id_usuario` dueño del desafío.
   * @throws {@link UnauthorizedException} si el desafío no existe, expiró o el
   * código no coincide. Siempre el mismo mensaje, para no dar pistas.
   */
  async verify(challengeId: string, code: string): Promise<string> {
    const invalid = new UnauthorizedException(
      'El código no es válido o ya expiró',
    );
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT id_usuario, codigo_hash, intentos FROM Desafio_DosPasos WHERE id_desafio = ? AND expira > NOW()',
      [challengeId],
    );
    const row = rows[0];
    if (!row) throw invalid;
    const expected = Buffer.from(String(row.codigo_hash));
    const received = Buffer.from(sha256(code));
    if (!timingSafeEqual(expected, received)) {
      if (Number(row.intentos) + 1 >= MAX_ATTEMPTS) {
        await this.remove(challengeId);
      } else {
        await this.pool.query(
          'UPDATE Desafio_DosPasos SET intentos = intentos + 1 WHERE id_desafio = ?',
          [challengeId],
        );
      }
      throw invalid;
    }
    await this.remove(challengeId);
    return String(row.id_usuario);
  }

  /** Anula los desafíos pendientes de una cuenta. */
  async clear(userId: string | number): Promise<void> {
    await this.pool.query('DELETE FROM Desafio_DosPasos WHERE id_usuario = ?', [
      userId,
    ]);
  }

  private async remove(challengeId: string): Promise<void> {
    await this.pool.query('DELETE FROM Desafio_DosPasos WHERE id_desafio = ?', [
      challengeId,
    ]);
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** `usuario@0fraude.mx` → `u••••••@0fraude.mx`. */
function mask(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return 'tu correo';
  return email[0] + '•'.repeat(Math.max(3, at - 1)) + email.slice(at);
}

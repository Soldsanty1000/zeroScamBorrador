import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { MailService } from './mail.service';

export type EmailCodePurpose = 'RECUPERAR' | 'CAMBIAR';

const CODE_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 3;
/** Códigos que una cuenta puede pedir por propósito en la ventana. */
export const SEND_LIMIT = 3;
export const SEND_WINDOW_MS = 15 * 60 * 1000;

/** Lo que recibe la app al pedir un código. */
export interface EmailCodeChallenge {
  challengeId: string;
  /** Correo enmascarado al que se mandó el código. */
  destination: string;
  /** ISO 8601. */
  expiresAt: string;
}

/**
 * Códigos de 6 dígitos por correo para recuperar o cambiar la contraseña
 * (`Codigo_Correo`). Igual que la verificación en dos pasos: en la base solo
 * va el hash, duran 10 minutos y admiten 3 intentos. Además, cada cuenta
 * puede pedir {@link SEND_LIMIT} códigos por propósito cada 15 minutos, para
 * que nadie use el servicio para llenarle el buzón a otra persona.
 */
@Injectable()
export class EmailCodeService {
  /** Envíos recientes por `usuario|propósito`. Vive en memoria. */
  private readonly sends = new Map<string, number[]>();

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly mail: MailService,
  ) {}

  /** Un id de desafío nuevo (también para respuestas sin cuenta detrás). */
  newId(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Crea un código, anula los anteriores del mismo propósito y lo manda.
   *
   * @param id - Id del desafío (de {@link newId}).
   * @throws {@link HttpException} 429 si la cuenta ya pidió demasiados.
   * @throws {@link ServiceUnavailableException} si el correo no salió; el
   * código se retira.
   */
  async create(
    id: string,
    userId: string,
    email: string,
    purpose: EmailCodePurpose,
  ): Promise<EmailCodeChallenge> {
    this.takeSendSlot(`${userId}|${purpose}`);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expires = new Date(Date.now() + CODE_TTL_SECONDS * 1000);
    await this.pool.query(
      'DELETE FROM Codigo_Correo WHERE (id_usuario = ? AND proposito = ?) OR expira <= NOW()',
      [userId, purpose],
    );
    await this.pool.query(
      'INSERT INTO Codigo_Correo (id_codigo, id_usuario, proposito, codigo_hash, expira) VALUES (?, ?, ?, ?, ?)',
      [id, userId, purpose, sha256(code), expires],
    );
    try {
      await this.mail.sendCode(
        email,
        code,
        CODE_TTL_SECONDS / 60,
        purpose === 'RECUPERAR' ? 'recuperar' : 'cambiar',
      );
    } catch (err) {
      await this.remove(id);
      throw err;
    }
    return {
      challengeId: id,
      destination: mask(email),
      expiresAt: expires.toISOString(),
    };
  }

  /** Cuándo vencería un código pedido ahora (para respuestas sin cuenta). */
  expiresFromNow(): string {
    return new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();
  }

  /**
   * Comprueba un código y lo consume.
   *
   * @returns El `id_usuario` dueño del código, o `undefined` si el desafío
   * no existe, expiró, es de otro propósito o el código no coincide. Tres
   * fallos borran el desafío.
   */
  async verify(
    challengeId: string,
    code: string,
    purpose: EmailCodePurpose,
  ): Promise<string | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT id_usuario, codigo_hash, intentos FROM Codigo_Correo WHERE id_codigo = ? AND proposito = ? AND expira > NOW()',
      [challengeId, purpose],
    );
    const row = rows[0];
    if (!row) return undefined;
    const ok = timingSafeEqual(
      Buffer.from(String(row.codigo_hash)),
      Buffer.from(sha256(code)),
    );
    if (!ok) {
      if (Number(row.intentos) + 1 >= MAX_ATTEMPTS) {
        await this.remove(challengeId);
      } else {
        await this.pool.query(
          'UPDATE Codigo_Correo SET intentos = intentos + 1 WHERE id_codigo = ?',
          [challengeId],
        );
      }
      return undefined;
    }
    await this.remove(challengeId);
    return String(row.id_usuario);
  }

  /** Anula todos los códigos pendientes de una cuenta. */
  async clear(userId: string | number): Promise<void> {
    await this.pool.query('DELETE FROM Codigo_Correo WHERE id_usuario = ?', [
      userId,
    ]);
  }

  private takeSendSlot(key: string): void {
    const now = Date.now();
    const recent = (this.sends.get(key) ?? []).filter(
      (t) => now - t < SEND_WINDOW_MS,
    );
    if (recent.length >= SEND_LIMIT) {
      this.sends.set(key, recent);
      throw new HttpException(
        'Pediste varios códigos seguidos. Espera unos minutos e inténtalo de nuevo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.sends.set(key, recent);
  }

  private async remove(challengeId: string): Promise<void> {
    await this.pool.query('DELETE FROM Codigo_Correo WHERE id_codigo = ?', [
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

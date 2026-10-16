import { Injectable } from '@nestjs/common';

interface Attempt {
  fails: number;
  lockedUntil: number;
}

/**
 * Límite de intentos fallidos de login, en memoria del servidor.
 *
 * Mismas reglas que la app: 5 fallos seguidos bloquean 1 minuto y cada fallo
 * posterior lo duplica hasta 15 minutos; un acierto reinicia la cuenta. La
 * llave es correo + IP: así quien adivine contraseñas se bloquea a sí mismo,
 * pero no puede dejar fuera a la víctima desde otra dirección.
 *
 * Es por proceso: con varias instancias haría falta guardarlo en la base.
 */
@Injectable()
export class LoginAttempts {
  static readonly ALLOWED = 5;
  static readonly BASE_SECONDS = 60;
  static readonly MAX_SECONDS = 15 * 60;
  private static readonly MAX_ENTRIES = 10_000;

  private readonly records = new Map<string, Attempt>();

  static key(email: string, ip: string): string {
    return `${email.trim().toLowerCase()}|${ip}`;
  }

  /** Segundos que faltan para poder intentar de nuevo; 0 si ya puede. */
  secondsLocked(key: string, now = Date.now()): number {
    const record = this.records.get(key);
    if (!record || record.lockedUntil <= now) return 0;
    return Math.ceil((record.lockedUntil - now) / 1000);
  }

  /** Cuenta un fallo y, pasado el límite, bloquea. */
  fail(key: string, now = Date.now()): void {
    this.prune(now);
    const record = this.records.get(key) ?? { fails: 0, lockedUntil: 0 };
    record.fails += 1;
    if (record.fails >= LoginAttempts.ALLOWED) {
      const extra = Math.min(record.fails - LoginAttempts.ALLOWED, 20);
      const seconds = Math.min(
        LoginAttempts.BASE_SECONDS * 2 ** extra,
        LoginAttempts.MAX_SECONDS,
      );
      record.lockedUntil = now + seconds * 1000;
    }
    this.records.set(key, record);
  }

  /** Un acierto borra el historial de fallos. */
  success(key: string): void {
    this.records.delete(key);
  }

  /** Evita que el mapa crezca sin límite con intentos de correos inventados. */
  private prune(now: number): void {
    if (this.records.size < LoginAttempts.MAX_ENTRIES) return;
    for (const [key, record] of this.records) {
      if (record.lockedUntil <= now) this.records.delete(key);
    }
    if (this.records.size >= LoginAttempts.MAX_ENTRIES) this.records.clear();
  }
}

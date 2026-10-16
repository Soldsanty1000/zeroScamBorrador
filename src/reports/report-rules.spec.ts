import { ConflictException } from '@nestjs/common';
import { STATUSES } from '../common/constants';
import {
  AUTHOR_DELETABLE_STATUSES,
  COMMUNITY_EDITABLE_STATUSES,
  MODERATOR_DELETABLE_STATUSES,
  REPORT_QUOTA_WHERE,
  REPORTS_PER_DAY,
  STATUS_TRANSITIONS,
  canTransition,
  deletableStatuses,
  invalidTransition,
  notDeletable,
  quotaError,
  reportQuotaExceeded,
  reportQuotaParams,
} from './report-rules';

/** La tabla de verdad de la máquina de estados, escrita aparte a propósito. */
const ALLOWED: [string, string][] = [
  ['RECIBIDO', 'EN_REVISION'],
  ['RECIBIDO', 'RECHAZADO'],
  ['EN_REVISION', 'VALIDADO'],
  ['EN_REVISION', 'RECHAZADO'],
  ['VALIDADO', 'CANALIZADO'],
];

describe('máquina de estados de los reportes', () => {
  it('permite únicamente las cinco transiciones definidas', () => {
    const allowed: [string, string][] = [];
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (canTransition(from, to)) allowed.push([from, to]);
      }
    }
    expect(allowed).toEqual(ALLOWED);
  });

  it.each(ALLOWED)('%s -> %s está permitida', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each(
    STATUSES.flatMap((from) => STATUSES.map((to) => [from, to])).filter(
      ([from, to]) => !ALLOWED.some(([f, t]) => f === from && t === to),
    ),
  )('%s -> %s está prohibida', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('RECHAZADO y CANALIZADO son finales', () => {
    expect(STATUS_TRANSITIONS.RECHAZADO).toEqual([]);
    expect(STATUS_TRANSITIONS.CANALIZADO).toEqual([]);
  });

  it('nunca se vuelve a RECIBIDO', () => {
    for (const from of STATUSES)
      expect(canTransition(from, 'RECIBIDO')).toBe(false);
  });

  it('un estado o destino desconocido no es una transición', () => {
    expect(canTransition('INVENTADO', 'VALIDADO')).toBe(false);
    expect(canTransition('RECIBIDO', 'INVENTADO')).toBe(false);
  });

  it('el error de salir de un estado final lo dice', () => {
    const error = invalidTransition('CANALIZADO', 'RECHAZADO');
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(
      'El reporte está en CANALIZADO, que es un estado final',
    );
  });

  it('el error de un salto inválido enumera lo que sí se permite', () => {
    const error = invalidTransition('RECIBIDO', 'VALIDADO');
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toContain('de RECIBIDO a VALIDADO');
    expect(error.message).toContain('EN_REVISION o RECHAZADO');
  });
});

describe('regla de borrado', () => {
  it('el autor solo borra en RECIBIDO', () => {
    expect(AUTHOR_DELETABLE_STATUSES).toEqual(['RECIBIDO']);
    expect(deletableStatuses(false)).toEqual(['RECIBIDO']);
  });

  it('Administrador y Owner solo borran RECIBIDO o RECHAZADO', () => {
    expect(MODERATOR_DELETABLE_STATUSES).toEqual(['RECIBIDO', 'RECHAZADO']);
    expect(deletableStatuses(true)).toEqual(['RECIBIDO', 'RECHAZADO']);
  });

  it.each(['EN_REVISION', 'VALIDADO', 'CANALIZADO'])(
    '%s no lo borra nadie',
    (status) => {
      expect(deletableStatuses(false)).not.toContain(status);
      expect(deletableStatuses(true)).not.toContain(status);
    },
  );

  it('el 409 explica por qué no se puede borrar', () => {
    const error = notDeletable('VALIDADO', deletableStatuses(true));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toContain('VALIDADO');
    expect(error.message).toContain('RECIBIDO o RECHAZADO');
    expect(error.message).toContain('registro de verificación');
  });

  it('el autor edita en RECIBIDO y EN_REVISION, no después', () => {
    expect(COMMUNITY_EDITABLE_STATUSES).toEqual(['RECIBIDO', 'EN_REVISION']);
  });
});

describe('cuota diaria de reportes', () => {
  it('son 10 por día y el SQL lleva el conteo y el tope como parámetros', () => {
    expect(REPORTS_PER_DAY).toBe(10);
    expect(REPORT_QUOTA_WHERE.match(/\?/g)).toHaveLength(2);
    expect(reportQuotaParams('7')).toEqual(['7', 10]);
  });

  it('el exceso responde 429', () => {
    expect(reportQuotaExceeded().getStatus()).toBe(429);
  });

  it('un abrazo mortal de la cuota se vuelve 429; otros errores pasan igual', () => {
    const deadlock = Object.assign(new Error('deadlock'), {
      code: 'ER_LOCK_DEADLOCK',
    });
    const other = new Error('otra cosa');
    expect(
      (quotaError(deadlock, 'espera') as { getStatus(): number }).getStatus(),
    ).toBe(429);
    expect(quotaError(other, 'espera')).toBe(other);
  });
});

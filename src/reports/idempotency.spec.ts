import { BadRequestException } from '@nestjs/common';
import type { Pool, PoolConnection } from 'mysql2/promise';
import {
  IDEMPOTENCY_HOURS,
  IDEMPOTENCY_KEY_PATTERN,
  bindIdempotencyKey,
  claimIdempotencyKey,
  parseIdempotencyKey,
  pruneIdempotencyKeys,
} from './idempotency';

describe('Idempotency-Key (IOS-L15)', () => {
  describe('parseIdempotencyKey', () => {
    it('sin cabecera no hay clave y no pasa nada: el comportamiento de siempre', () => {
      expect(parseIdempotencyKey(undefined)).toBeUndefined();
    });

    it.each([
      '12345678',
      'a'.repeat(64),
      'Abc_123-xyz',
      '550e8400-e29b-41d4-a716-446655440000',
      'ABCDEFGH',
      'a_b-c_d-e_f',
    ])('acepta "%s"', (key) => {
      expect(parseIdempotencyKey(key)).toBe(key);
    });

    it.each([
      ['muy corta (7)', '1234567'],
      ['muy larga (65)', 'a'.repeat(65)],
      ['vacía', ''],
      ['con espacio', 'clave con espacio'],
      ['con punto', 'clave.12345678'],
      ['con acento', 'clavé-12345678'],
      ['con barra', 'clave/12345678'],
      ['con salto de línea', 'clave-1234\n5678'],
      ['con comillas', "clave'12345678"],
      ['con coma (cabecera repetida)', 'clave-12345678, clave-87654321'],
    ])('rechaza una clave %s con 400', (_name, key) => {
      expect(() => parseIdempotencyKey(key)).toThrow(BadRequestException);
    });

    it('una cabecera repetida (arreglo) se rechaza', () => {
      expect(() =>
        parseIdempotencyKey(['clave-12345678', 'clave-87654321']),
      ).toThrow(BadRequestException);
    });

    it('el mensaje dice cómo debe ser', () => {
      expect(() => parseIdempotencyKey('x')).toThrow(/8 a 64 caracteres/);
    });

    it('el patrón es exactamente de 8 a 64 caracteres [A-Za-z0-9_-]', () => {
      expect(IDEMPOTENCY_KEY_PATTERN.source).toBe('^[A-Za-z0-9_-]{8,64}$');
    });
  });

  describe('claimIdempotencyKey', () => {
    function connection(options: {
      inserted: number;
      existing?: { id_reporte: number | null }[];
    }) {
      const queries: { sql: string; params: unknown[] }[] = [];
      const conn = {
        query: jest.fn((sql: string, params: unknown[] = []) => {
          queries.push({ sql, params });
          const text = sql.trim();
          if (/^INSERT IGNORE/.test(text)) {
            return Promise.resolve([{ affectedRows: options.inserted }]);
          }
          if (/^SELECT id_reporte/.test(text)) {
            return Promise.resolve([options.existing ?? []]);
          }
          return Promise.resolve([{ affectedRows: 0 }]);
        }),
      };
      return { conn: conn as unknown as PoolConnection, queries };
    }

    it('una clave nueva queda reservada y no devuelve reporte', async () => {
      const { conn, queries } = connection({ inserted: 1 });

      await expect(
        claimIdempotencyKey(conn, 7, 'clave-12345678'),
      ).resolves.toBeUndefined();

      expect(queries.some((q) => /^SELECT/.test(q.sql.trim()))).toBe(false);
    });

    it('antes de reservar libera SOLO esta clave si ya caducó (24 h)', async () => {
      const { conn, queries } = connection({ inserted: 1 });

      await claimIdempotencyKey(conn, 7, 'clave-12345678');

      const [expire] = queries;
      expect(expire.sql).toMatch(
        /DELETE FROM Reporte_Idempotencia\s+WHERE id_usuario = \? AND clave = \? AND creada < DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/,
      );
      expect(expire.params).toEqual([7, 'clave-12345678', IDEMPOTENCY_HOURS]);
      expect(IDEMPOTENCY_HOURS).toBe(24);
    });

    it('la reserva es por usuario: la clave y el usuario van juntos', async () => {
      const { conn, queries } = connection({ inserted: 1 });

      await claimIdempotencyKey(conn, 7, 'clave-12345678');

      const insert = queries.find((q) => /^INSERT IGNORE/.test(q.sql.trim()))!;
      expect(insert.params).toEqual([7, 'clave-12345678']);
    });

    it('si la clave ya existía devuelve el reporte que creó', async () => {
      const { conn, queries } = connection({
        inserted: 0,
        existing: [{ id_reporte: 41 }],
      });

      await expect(
        claimIdempotencyKey(conn, 7, 'clave-12345678'),
      ).resolves.toBe(41);

      const read = queries.find((q) => /^SELECT/.test(q.sql.trim()))!;
      expect(read.sql).toMatch(
        /WHERE id_usuario = \? AND clave = \? FOR UPDATE/,
      );
      expect(read.params).toEqual([7, 'clave-12345678']);
    });

    it('la clave de otro usuario no devuelve su reporte (la búsqueda lleva el usuario)', async () => {
      const { conn, queries } = connection({ inserted: 1 });

      await claimIdempotencyKey(conn, 8, 'clave-12345678');

      expect(queries.every((q) => q.params[0] === 8)).toBe(true);
    });

    it('una clave sin reporte (creación interrumpida) se puede reutilizar', async () => {
      const { conn } = connection({
        inserted: 0,
        existing: [{ id_reporte: null }],
      });

      await expect(
        claimIdempotencyKey(conn, 7, 'clave-12345678'),
      ).resolves.toBeUndefined();
    });

    it('un id que llega como texto se regresa como número', async () => {
      const { conn } = connection({
        inserted: 0,
        existing: [{ id_reporte: '41' as unknown as number }],
      });

      await expect(
        claimIdempotencyKey(conn, 7, 'clave-12345678'),
      ).resolves.toBe(41);
    });
  });

  describe('bindIdempotencyKey', () => {
    it('liga la clave del usuario con el reporte creado', async () => {
      const query = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);

      await bindIdempotencyKey(
        { query } as unknown as PoolConnection,
        7,
        'clave-12345678',
        55,
      );

      expect(query).toHaveBeenCalledWith(
        'UPDATE Reporte_Idempotencia SET id_reporte = ? WHERE id_usuario = ? AND clave = ?',
        [55, 7, 'clave-12345678'],
      );
    });
  });

  describe('pruneIdempotencyKeys', () => {
    it('borra las claves de más de 24 horas', async () => {
      const query = jest
        .fn<Promise<unknown>, [string, unknown[]]>()
        .mockResolvedValue([{ affectedRows: 3 }]);

      await pruneIdempotencyKeys({ query } as unknown as Pool);

      expect(query.mock.calls[0][0]).toMatch(
        /DELETE FROM Reporte_Idempotencia WHERE creada < DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/,
      );
      expect(query.mock.calls[0][1]).toEqual([24]);
    });

    it('un fallo al limpiar nunca afecta a quien creó el reporte', async () => {
      const query = jest.fn().mockRejectedValue(new Error('sin conexión'));

      await expect(
        pruneIdempotencyKeys({ query } as unknown as Pool),
      ).resolves.toBeUndefined();
    });
  });
});

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { CommunityRepository, ReportInput } from './community.repository';

// Igual que en reports.repository.spec.ts: un pool falso que registra las
// sentencias para comprobar qué se ejecuta (bloqueo, condiciones, rollback).

const STATUS_IDS: Record<string, number> = {
  RECIBIDO: 1,
  EN_REVISION: 2,
  VALIDADO: 3,
  RECHAZADO: 4,
  CANALIZADO: 5,
};

interface World {
  status?: string;
  evidence?: string[];
  /** `affectedRows` de los INSERT … SELECT de las cuotas. */
  quotaInserts?: number;
}

function setup(world: World) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const answer = (sql: string, params: unknown[] = []): unknown => {
    queries.push({ sql, params });
    if (/FOR UPDATE/.test(sql)) {
      return [
        world.status
          ? [
              {
                id_estado: STATUS_IDS[world.status],
                id_usuario: 5,
                nivel_riesgo_asignado: 'NO_EVALUADO',
              },
            ]
          : [],
      ];
    }
    if (/SELECT nombre_estado FROM Estado WHERE id_estado/.test(sql)) {
      return [[{ nombre_estado: world.status }]];
    }
    if (/SELECT COUNT\(\*\) AS total FROM Evidencia/.test(sql)) {
      return [[{ total: world.evidence?.length ?? 0 }]];
    }
    if (/SELECT ruta_archivo FROM Evidencia/.test(sql)) {
      return [(world.evidence ?? []).map((f) => ({ ruta_archivo: f }))];
    }
    if (/^INSERT INTO (Reporte|Comentario) \(/.test(sql.trim())) {
      return [{ affectedRows: world.quotaInserts ?? 1, insertId: 31 }];
    }
    return [[]];
  };
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    query: jest.fn((sql: string, params?: unknown[]) =>
      Promise.resolve(answer(sql, params)),
    ),
  };
  const pool = {
    getConnection: jest.fn().mockResolvedValue(conn),
    query: conn.query,
  };
  const repository = new CommunityRepository(pool as unknown as Pool);
  const ran = (pattern: RegExp) =>
    queries.filter((q) => pattern.test(q.sql.trim()));
  return { repository, conn, queries, ran };
}

const input: ReportInput = {
  fraudTypeId: 7,
  otherType: undefined,
  title: 'Tienda falsa de tenis en Instagram',
  description: 'Me cobraron y nunca llegó el paquete que compré.',
  incidentDate: new Date('2026-09-10T18:30:00.000Z'),
  anonymous: false,
  affected: 'YO',
  affectedPerson: undefined,
  city: 'Guadalajara',
  url: undefined,
  suspiciousText: undefined,
};

describe('CommunityRepository', () => {
  describe('delete: la cadena de custodia no se rompe', () => {
    it.each(['EN_REVISION', 'VALIDADO', 'CANALIZADO'])(
      'un reporte %s no se borra por nadie, ni con permiso de moderación',
      async (status) => {
        const { repository, conn, ran } = setup({ status });

        await expect(
          repository.delete(3, ['RECIBIDO', 'RECHAZADO']),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(ran(/^DELETE/)).toHaveLength(0);
        expect(ran(/^UPDATE/)).toHaveLength(0);
        expect(conn.rollback).toHaveBeenCalledTimes(1);
        expect(conn.commit).not.toHaveBeenCalled();
      },
    );

    it('la fila se bloquea antes de decidir', async () => {
      const { repository, queries } = setup({ status: 'RECIBIDO' });

      await repository.delete(3, ['RECIBIDO']);

      expect(queries[0].sql).toMatch(
        /FROM Reporte WHERE id_reporte = \? FOR UPDATE/,
      );
    });

    it('un RECHAZADO lo borra la moderación pero no el autor', async () => {
      const mod = setup({ status: 'RECHAZADO', evidence: ['a.jpg'] });
      await expect(
        mod.repository.delete(3, ['RECIBIDO', 'RECHAZADO']),
      ).resolves.toEqual({ status: 'RECHAZADO', files: ['a.jpg'] });

      const authorSide = setup({ status: 'RECHAZADO' });
      await expect(
        authorSide.repository.delete(3, ['RECIBIDO']),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('un reporte que no existe responde 404', async () => {
      const { repository } = setup({ status: undefined });

      await expect(repository.delete(3, ['RECIBIDO'])).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update: condicionado al estado editable dentro de la transacción', () => {
    it.each(['VALIDADO', 'RECHAZADO', 'CANALIZADO'])(
      'si ya está %s no escribe nada',
      async (status) => {
        const { repository, conn, ran } = setup({ status });

        await expect(repository.update(3, input, [])).rejects.toBeInstanceOf(
          ConflictException,
        );

        expect(ran(/^UPDATE/)).toHaveLength(0);
        expect(ran(/^DELETE/)).toHaveLength(0);
        expect(conn.rollback).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['RECIBIDO', 'EN_REVISION'])('en %s edita', async (status) => {
      const { repository, conn, ran } = setup({ status });

      await repository.update(3, input, []);

      expect(ran(/^UPDATE Reporte SET/)).toHaveLength(1);
      expect(conn.commit).toHaveBeenCalledTimes(1);
    });
  });

  describe('addEvidence', () => {
    it('en un reporte VALIDADO responde 409 y no inserta', async () => {
      const { repository, ran } = setup({ status: 'VALIDADO' });

      await expect(
        repository.addEvidence(3, 'a.jpg', 'image/jpeg', 3),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ran(/^INSERT INTO Evidencia/)).toHaveLength(0);
    });

    it('con el tope de archivos responde 400', async () => {
      const { repository, ran } = setup({
        status: 'EN_REVISION',
        evidence: ['1.jpg', '2.jpg', '3.jpg'],
      });

      await expect(
        repository.addEvidence(3, 'a.jpg', 'image/jpeg', 3),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ran(/^INSERT INTO Evidencia/)).toHaveLength(0);
    });
  });

  describe('cuotas atómicas (API-16)', () => {
    it('crear: una sola sentencia INSERT … SELECT condicionada al conteo', async () => {
      const { repository, ran } = setup({ status: 'RECIBIDO' });

      await expect(repository.create(5, input)).resolves.toBe(31);

      const [insert] = ran(/^INSERT INTO Reporte \(/);
      expect(insert.sql).toMatch(
        /FROM DUAL WHERE \(SELECT COUNT\(\*\) FROM Reporte/,
      );
      expect(insert.params.slice(-2)).toEqual([5, 10]);
    });

    it('crear: con la cuota agotada responde 429 y deja todo deshecho', async () => {
      const { repository, conn, ran } = setup({ quotaInserts: 0 });

      await expect(repository.create(5, input)).rejects.toMatchObject({
        status: 429,
      });

      expect(ran(/^INSERT INTO Historial_Estado/)).toHaveLength(0);
      expect(ran(/^INSERT INTO Notificacion_Alerta/)).toHaveLength(0);
      expect(conn.rollback).toHaveBeenCalledTimes(1);
    });

    it('comentar: cuenta e inserta en una sola sentencia con tope de 5 por minuto', async () => {
      const { repository, ran } = setup({});
      await repository.addComment(3, 5, 'hola');

      const [insert] = ran(/^INSERT INTO Comentario \(/);
      expect(insert.sql).toMatch(
        /FROM DUAL\s+WHERE \(SELECT COUNT\(\*\) FROM Comentario/,
      );
      expect(insert.params).toEqual([3, 5, 'hola', 5, 5]);
    });

    it('comentar: con la cuota agotada responde 429', async () => {
      const { repository } = setup({ quotaInserts: 0 });

      await expect(repository.addComment(3, 5, 'hola')).rejects.toMatchObject({
        status: 429,
      });
    });
  });
});

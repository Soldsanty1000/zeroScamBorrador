import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { MAX_LIST_RESULTS, ReportsRepository } from './reports.repository';

// El repositorio habla con MySQL; aquí se reemplaza el pool por uno falso que
// registra cada sentencia, para comprobar QUÉ se ejecuta y en qué orden (el
// bloqueo de la fila, las condiciones del UPDATE, el rollback) sin base real.

const STATUS_IDS: Record<string, number> = {
  RECIBIDO: 1,
  EN_REVISION: 2,
  VALIDADO: 3,
  RECHAZADO: 4,
  CANALIZADO: 5,
};

interface World {
  /** Estado del reporte; `undefined` = no existe. */
  status?: string;
  riskLevel?: string;
  /** Archivos de evidencia que ya tiene. */
  evidence?: string[];
  /** `affectedRows` del INSERT … SELECT de la cuota. */
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
                id_usuario: 7,
                nivel_riesgo_asignado: world.riskLevel ?? 'NO_EVALUADO',
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
    if (/INSERT INTO Reporte \(/.test(sql)) {
      return [{ affectedRows: world.quotaInserts ?? 1, insertId: 55 }];
    }
    if (/INSERT INTO SitioWeb_URL/.test(sql)) return [{ insertId: 9 }];
    if (/^UPDATE Reporte SET id_estado/.test(sql)) return [{ affectedRows: 1 }];
    if (/JOIN TipoFraude/.test(sql)) {
      return [
        [
          {
            id_reporte: 12,
            id_usuario: 7,
            id_tipo_fraude: 1,
            nombre_tipo: 'Phishing',
            nombre_estado: world.status ?? 'RECIBIDO',
            descripcion_incidente: 'x',
            fecha_incidente: new Date(),
            nivel_riesgo_asignado: 'NO_EVALUADO',
            fecha_creacion: new Date(),
            es_anonimo: 1,
          },
        ],
      ];
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
  const repository = new ReportsRepository(pool as unknown as Pool);
  const ran = (pattern: RegExp) =>
    queries.filter((q) => pattern.test(q.sql.trim()));
  return { repository, conn, queries, ran };
}

describe('ReportsRepository', () => {
  describe('changeStatus (atómico)', () => {
    it('bloquea la fila, condiciona el UPDATE al estado leído y registra el historial', async () => {
      const { repository, conn, queries, ran } = setup({ status: 'RECIBIDO' });

      await repository.changeStatus(12, '2', 'RECIBIDO', 'EN_REVISION', 'ok');

      // Lo primero es el bloqueo de la fila.
      expect(queries[0].sql).toMatch(
        /FROM Reporte WHERE id_reporte = \? FOR UPDATE/,
      );
      const [update] = ran(/^UPDATE Reporte SET id_estado/);
      expect(update.sql).toMatch(/WHERE id_reporte = \? AND id_estado = \?/);
      expect(update.params).toEqual(['EN_REVISION', 12, STATUS_IDS.RECIBIDO]);
      const [history] = ran(/^INSERT INTO Historial_Estado/);
      expect(history.params).toEqual([
        12,
        '2',
        STATUS_IDS.RECIBIDO,
        'EN_REVISION',
        'ok',
      ]);
      expect(ran(/^INSERT INTO Notificacion_Alerta/)).toHaveLength(1);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      expect(conn.rollback).not.toHaveBeenCalled();
    });

    it('si el estado ya no es el esperado responde 409 y no escribe nada', async () => {
      // Otro administrador ya lo pasó a VALIDADO mientras éste lo revisaba.
      const { repository, conn, ran } = setup({ status: 'VALIDADO' });

      await expect(
        repository.changeStatus(12, '2', 'EN_REVISION', 'RECHAZADO', 'x'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(ran(/^UPDATE/)).toHaveLength(0);
      expect(ran(/^INSERT/)).toHaveLength(0);
      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.commit).not.toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['RECHAZADO', 'VALIDADO'],
      ['CANALIZADO', 'RECHAZADO'],
      ['RECIBIDO', 'CANALIZADO'],
    ])('con la fila bloqueada también rechaza %s -> %s', async (from, to) => {
      const { repository, conn, ran } = setup({ status: from });

      await expect(
        repository.changeStatus(12, '2', from, to, 'x'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(ran(/^UPDATE/)).toHaveLength(0);
      expect(conn.rollback).toHaveBeenCalledTimes(1);
    });

    it('un reporte que ya no existe responde 404', async () => {
      const { repository, conn } = setup({ status: undefined });

      await expect(
        repository.changeStatus(12, '2', 'RECIBIDO', 'EN_REVISION', undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(conn.rollback).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it.each(['EN_REVISION', 'VALIDADO', 'CANALIZADO'])(
      'un reporte %s no se borra aunque llegue a pedirse',
      async (status) => {
        const { repository, conn, ran } = setup({ status });

        await expect(
          repository.delete(12, ['RECIBIDO', 'RECHAZADO']),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(ran(/^DELETE/)).toHaveLength(0);
        expect(conn.rollback).toHaveBeenCalledTimes(1);
        expect(conn.commit).not.toHaveBeenCalled();
      },
    );

    it('el autor (solo RECIBIDO) no borra un RECHAZADO', async () => {
      const { repository, ran } = setup({ status: 'RECHAZADO' });

      await expect(repository.delete(12, ['RECIBIDO'])).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(ran(/^DELETE/)).toHaveLength(0);
    });

    it('borra un RECIBIDO, hijos primero, y regresa sus archivos', async () => {
      const { repository, conn, ran } = setup({
        status: 'RECIBIDO',
        evidence: ['a.jpg', 'b.pdf'],
      });

      const deleted = await repository.delete(12, ['RECIBIDO']);

      expect(deleted).toEqual({
        status: 'RECIBIDO',
        files: ['a.jpg', 'b.pdf'],
      });
      expect(ran(/^DELETE/).map((q) => q.sql.match(/FROM (\w+)/)![1])).toEqual([
        'Notificacion_Alerta',
        'Historial_Estado',
        'Evidencia',
        'Reporte_URL',
        'Reporte',
      ]);
      expect(conn.commit).toHaveBeenCalledTimes(1);
    });

    it('un reporte que no existe responde 404', async () => {
      const { repository } = setup({ status: undefined });

      await expect(repository.delete(12, ['RECIBIDO'])).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setRisk', () => {
    it('un reporte RECHAZADO responde 409 y no escribe', async () => {
      const { repository, ran } = setup({ status: 'RECHAZADO' });

      await expect(repository.setRisk(12, '2', 'ALTO')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(ran(/^UPDATE/)).toHaveLength(0);
      expect(ran(/^INSERT/)).toHaveLength(0);
    });

    it.each(['RECIBIDO', 'EN_REVISION', 'VALIDADO', 'CANALIZADO'])(
      'en %s clasifica y regresa el nivel anterior',
      async (status) => {
        const { repository, ran } = setup({ status, riskLevel: 'MEDIO' });

        const result = await repository.setRisk(12, '2', 'ALTO');

        expect(result.previousRiskLevel).toBe('MEDIO');
        expect(ran(/^UPDATE Reporte SET nivel_riesgo_asignado/)).toHaveLength(
          1,
        );
        expect(ran(/^INSERT INTO Historial_Estado/)).toHaveLength(1);
      },
    );
  });

  describe('update (legacy)', () => {
    it.each(['EN_REVISION', 'VALIDADO', 'RECHAZADO', 'CANALIZADO'])(
      'si el reporte ya está %s la edición se rechaza dentro de la transacción',
      async (status) => {
        const { repository, conn, ran } = setup({ status });

        await expect(
          repository.update(12, { description: 'cambiado' }),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(ran(/^UPDATE/)).toHaveLength(0);
        expect(conn.rollback).toHaveBeenCalledTimes(1);
      },
    );

    it('en RECIBIDO edita', async () => {
      const { repository, ran } = setup({ status: 'RECIBIDO' });

      await repository.update(12, { description: 'cambiado' });

      expect(ran(/^UPDATE Reporte SET descripcion_incidente/)).toHaveLength(1);
    });
  });

  describe('addEvidence (legacy)', () => {
    it.each(['EN_REVISION', 'VALIDADO', 'RECHAZADO', 'CANALIZADO'])(
      'en %s responde 409 y no inserta',
      async (status) => {
        const { repository, ran } = setup({ status });

        await expect(
          repository.addEvidence(12, 'a.jpg', 'image/jpeg', 3),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(ran(/^INSERT INTO Evidencia/)).toHaveLength(0);
      },
    );

    it('con el máximo de archivos responde 400', async () => {
      const { repository, ran } = setup({
        status: 'RECIBIDO',
        evidence: ['1.jpg', '2.jpg', '3.jpg'],
      });

      await expect(
        repository.addEvidence(12, 'a.jpg', 'image/jpeg', 3),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ran(/^INSERT INTO Evidencia/)).toHaveLength(0);
    });

    it('en RECIBIDO y por debajo del tope inserta', async () => {
      const { repository, ran } = setup({
        status: 'RECIBIDO',
        evidence: ['1.jpg'],
      });

      await repository.addEvidence(12, 'a.jpg', 'image/jpeg', 3);

      expect(ran(/^INSERT INTO Evidencia/)).toHaveLength(1);
    });
  });

  describe('save: cuota diaria atómica', () => {
    const data = {
      fraudTypeId: 1,
      description: 'Me pidieron mi NIP',
      incidentDate: new Date('2026-09-10T18:30:00.000Z'),
      urls: ['https://banco-seguro-mx.com/login'],
    };

    it('cuenta e inserta en una sola sentencia INSERT … SELECT condicionada', async () => {
      const { repository, ran } = setup({ status: 'RECIBIDO' });

      await repository.save('7', data);

      const [insert] = ran(/^INSERT INTO Reporte \(/);
      expect(insert.sql).toMatch(
        /SELECT \?, \?, \(SELECT id_estado FROM Estado/,
      );
      expect(insert.sql).toMatch(
        /FROM DUAL WHERE \(SELECT COUNT\(\*\) FROM Reporte/,
      );
      // id del dueño, dos veces (insertar y contar), y el tope.
      expect(insert.params[0]).toBe('7');
      expect(insert.params.slice(-2)).toEqual(['7', 10]);
      expect(ran(/^INSERT INTO Reporte_URL/)).toHaveLength(1);
    });

    it('con la cuota agotada responde 429, deshace y no deja URLs ni avisos', async () => {
      const { repository, conn, ran } = setup({
        status: 'RECIBIDO',
        quotaInserts: 0,
      });

      const failure = repository.save('7', data);

      await expect(failure).rejects.toBeInstanceOf(HttpException);
      await expect(failure).rejects.toMatchObject({ status: 429 });
      expect(ran(/^INSERT INTO Reporte_URL/)).toHaveLength(0);
      expect(ran(/^INSERT INTO Notificacion_Alerta/)).toHaveLength(0);
      expect(conn.rollback).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAll: tope duro', () => {
    it('pide a lo más 500 filas, como parámetro', async () => {
      const { repository, queries } = setup({ status: 'RECIBIDO' });

      await repository.findAll({});

      expect(MAX_LIST_RESULTS).toBe(500);
      const [list] = queries;
      expect(list.sql).toMatch(
        /ORDER BY r\.fecha_creacion DESC, r\.id_reporte DESC\s+LIMIT \?/,
      );
      expect(list.params.at(-1)).toBe(500);
    });

    it('conserva el orden de los filtros antes del LIMIT', async () => {
      const { repository, queries } = setup({ status: 'RECIBIDO' });

      await repository.findAll({
        ownerId: '7',
        status: 'VALIDADO',
        q: 'banco',
      });

      expect(queries[0].params).toEqual(['7', 'VALIDADO', '%banco%', 500]);
    });
  });
});

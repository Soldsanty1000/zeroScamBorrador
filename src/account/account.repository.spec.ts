import type { Pool } from 'mysql2/promise';
import { AccountRepository, DELETED_STATUS } from './account.repository';

/** Pool falso: registra las sentencias de la conexión de la transacción. */
function setup(options: { failOn?: RegExp; evidence?: string[] } = {}) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    query: jest.fn((sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (options.failOn?.test(sql)) return Promise.reject(new Error('falló'));
      if (/SELECT e\.ruta_archivo FROM Evidencia/.test(sql)) {
        return Promise.resolve([
          (options.evidence ?? []).map((f) => ({ ruta_archivo: f })),
        ]);
      }
      return Promise.resolve([[]]);
    }),
  };
  const pool = { getConnection: jest.fn().mockResolvedValue(conn) };
  const repository = new AccountRepository(pool as unknown as Pool);
  const sqls = () => queries.map((q) => q.sql.replace(/\s+/g, ' ').trim());
  const indexOf = (pattern: RegExp) => sqls().findIndex((s) => pattern.test(s));
  return { repository, conn, queries, sqls, indexOf };
}

describe('AccountRepository.deleteAccount', () => {
  it('borra los comentarios del usuario dentro de la misma transacción', async () => {
    const { repository, conn, queries, indexOf } = setup();

    await repository.deleteAccount(9);

    const comments = indexOf(/^DELETE FROM Comentario WHERE id_usuario = \?$/);
    expect(comments).toBeGreaterThanOrEqual(0);
    expect(queries[comments].params).toEqual([9]);
    // Todo en una conexión, con un solo BEGIN y un solo COMMIT.
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    // Y antes de vaciar la fila de Usuario.
    expect(comments).toBeLessThan(indexOf(/^UPDATE Usuario SET/));
  });

  it('limpia todo lo que es de la persona', async () => {
    const { repository, sqls } = setup();

    await repository.deleteAccount(9);

    for (const table of [
      'Reporte_Guardado',
      'Reporte_Confirmacion',
      'Comentario',
      'Notificacion_Alerta',
      'Consulta_URL',
      'Desafio_DosPasos',
      'Sesion',
    ]) {
      expect(sqls()).toContain(`DELETE FROM ${table} WHERE id_usuario = ?`);
    }
  });

  it('bloquea sus reportes antes de decidir cuáles son públicos', async () => {
    const { repository, indexOf } = setup();

    await repository.deleteAccount(9);

    const lock = indexOf(/FROM Reporte WHERE id_usuario = \? FOR UPDATE/);
    expect(lock).toBe(0);
    expect(lock).toBeLessThan(indexOf(/^DELETE FROM Evidencia/));
  });

  it('conserva los reportes públicos (VALIDADO/CANALIZADO) pero los hace anónimos', async () => {
    const { repository, sqls, indexOf } = setup();

    await repository.deleteAccount(9);

    // Los que se borran por completo excluyen a los públicos…
    const hidden = sqls().find((s) => /^DELETE FROM Reporte WHERE/.test(s))!;
    expect(hidden).toContain("NOT IN ('VALIDADO', 'CANALIZADO')");
    // …y los que quedan se marcan anónimos.
    expect(
      indexOf(/^UPDATE Reporte SET es_anonimo = TRUE WHERE id_usuario = \?/),
    ).toBeGreaterThan(-1);
  });

  it('vacía la fila de Usuario con estado ELIMINADA y regresa los archivos a borrar', async () => {
    const { repository, queries } = setup({ evidence: ['a.jpg', 'b.pdf'] });

    const files = await repository.deleteAccount(9);

    expect(files).toEqual(['a.jpg', 'b.pdf']);
    const update = queries.find((q) =>
      /^UPDATE Usuario SET/.test(q.sql.trim()),
    )!;
    expect(update.params[1]).toBe(DELETED_STATUS);
    expect(update.params[2]).toBe(9);
  });

  it('si algo falla deshace todo y no confirma', async () => {
    const { repository, conn } = setup({ failOn: /^DELETE FROM Comentario/ });

    await expect(repository.deleteAccount(9)).rejects.toThrow('falló');

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

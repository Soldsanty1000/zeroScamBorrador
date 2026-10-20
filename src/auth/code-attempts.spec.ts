import type { Pool } from 'mysql2/promise';
import { EmailCodeService } from './email-code.service';
import { MailService } from './mail.service';
import { TwoFactorService } from './two-factor.service';

type Fila = Record<string, unknown>;

/**
 * Una tabla de MySQL en memoria con lo justo para `Codigo_Correo` y
 * `Desafio_DosPasos`. Cada consulta espera un turno antes de ejecutarse (de
 * golpe, como una sentencia de MySQL): así, las peticiones simultáneas se
 * intercalan entre consultas igual que con el pool real.
 */
class TablaFalsa {
  filas: Fila[] = [];

  constructor(private readonly tabla: string) {}

  async query(sql: string, params: unknown[] = []): Promise<[unknown]> {
    await new Promise((listo) => setImmediate(listo));
    const q = sql.replace(/\s+/g, ' ').trim();
    const valores = [...params];
    const insert = new RegExp(`^INSERT INTO ${this.tabla} \\(([^)]+)\\)`).exec(
      q,
    );
    if (insert) {
      const fila: Fila = { intentos: 0 };
      for (const col of insert[1].split(', ')) fila[col] = valores.shift();
      this.filas.push(fila);
      return [{ affectedRows: 1 }];
    }
    const [cabeza, where = ''] = q.split(' WHERE ');
    const cumple = this.condicion(where, valores);
    const elegidas = this.filas.filter(cumple);
    if (cabeza.startsWith('SELECT')) {
      const cols = cabeza
        .slice('SELECT '.length)
        .split(' FROM ')[0]
        .split(', ');
      return [
        elegidas.map((f) => Object.fromEntries(cols.map((c) => [c, f[c]]))),
      ];
    }
    if (cabeza.startsWith(`UPDATE ${this.tabla} SET intentos = intentos + 1`)) {
      for (const f of elegidas) f.intentos = Number(f.intentos) + 1;
      return [{ affectedRows: elegidas.length }];
    }
    if (cabeza.startsWith(`DELETE FROM ${this.tabla}`)) {
      this.filas = this.filas.filter((f) => !elegidas.includes(f));
      return [{ affectedRows: elegidas.length }];
    }
    throw new Error(`Consulta no esperada: ${q}`);
  }

  /** `a = ? AND b < ? AND expira > NOW()`, con `OR` y paréntesis. */
  private condicion(where: string, valores: unknown[]): (f: Fila) => boolean {
    const o = where.split(' OR ').map((parte) =>
      parte
        .replace(/^\((.*)\)$/, '$1')
        .split(' AND ')
        .map((c): ((f: Fila) => boolean) => {
          const [col, op, lado] = c.trim().split(' ');
          if (lado === 'NOW()') {
            return (f) =>
              op === '>'
                ? (f[col] as Date).getTime() > Date.now()
                : (f[col] as Date).getTime() <= Date.now();
          }
          const v = valores.shift();
          if (op === '=') return (f) => String(f[col]) === String(v);
          if (op === '<') return (f) => Number(f[col]) < Number(v);
          if (op === '>=') return (f) => Number(f[col]) >= Number(v);
          throw new Error(`Condición no esperada: ${c}`);
        }),
    );
    return (f) => o.some((y) => y.every((c) => c(f)));
  }
}

describe('Códigos por correo: intentos con peticiones simultáneas', () => {
  let tabla: TablaFalsa;
  let codigos: EmailCodeService;
  let enviado: string;

  beforeEach(async () => {
    tabla = new TablaFalsa('Codigo_Correo');
    const mail = {
      sendCode: jest.fn((_correo: string, codigo: string) => {
        enviado = codigo;
        return Promise.resolve();
      }),
    } as unknown as MailService;
    codigos = new EmailCodeService(tabla as unknown as Pool, mail);
    await codigos.create('a'.repeat(64), '7', 'dana@example.com', 'RECUPERAR');
  });

  const otro = () => String((Number(enviado) + 1) % 1_000_000).padStart(6, '0');

  it('diez intentos a la vez solo prueban 3 códigos', async () => {
    // El bueno va al final: con leer-y-luego-sumar, los diez leían 0 intentos.
    const intentos = [...Array<string>(9).fill(otro()), enviado];
    const resultados = await Promise.all(
      intentos.map((c) => codigos.verify('a'.repeat(64), c, 'RECUPERAR')),
    );
    expect(resultados.every((r) => r === undefined)).toBe(true);
    expect(tabla.filas).toHaveLength(0);
  });

  it('dos peticiones con el código bueno: solo una lo usa', async () => {
    const resultados = await Promise.all([
      codigos.verify('a'.repeat(64), enviado, 'RECUPERAR'),
      codigos.verify('a'.repeat(64), enviado, 'RECUPERAR'),
    ]);
    expect(resultados.filter((r) => r === '7')).toHaveLength(1);
  });

  it('tres fallos seguidos agotan el desafío', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(
        codigos.verify('a'.repeat(64), otro(), 'RECUPERAR'),
      ).resolves.toBeUndefined();
    }
    await expect(
      codigos.verify('a'.repeat(64), enviado, 'RECUPERAR'),
    ).resolves.toBeUndefined();
  });

  it('el desafío de otra cuenta no le gasta intentos a su dueño', async () => {
    await codigos.create('b'.repeat(64), '7', 'dana@example.com', 'CAMBIAR');
    for (let i = 0; i < 5; i++) {
      await expect(
        codigos.verify('b'.repeat(64), otro(), 'CAMBIAR', '8'),
      ).resolves.toBeUndefined();
    }
    await expect(
      codigos.verify('b'.repeat(64), enviado, 'CAMBIAR', '7'),
    ).resolves.toBe('7');
  });

  it('un código de recuperar no sirve para cambiar', async () => {
    await expect(
      codigos.verify('a'.repeat(64), enviado, 'CAMBIAR', '7'),
    ).resolves.toBeUndefined();
    await expect(
      codigos.verify('a'.repeat(64), enviado, 'RECUPERAR'),
    ).resolves.toBe('7');
  });
});

describe('Dos pasos: intentos con peticiones simultáneas', () => {
  let tabla: TablaFalsa;
  let dosPasos: TwoFactorService;
  let enviado: string;
  let id: string;

  beforeEach(async () => {
    tabla = new TablaFalsa('Desafio_DosPasos');
    const mail = {
      sendCode: jest.fn((_correo: string, codigo: string) => {
        enviado = codigo;
        return Promise.resolve();
      }),
    } as unknown as MailService;
    dosPasos = new TwoFactorService(tabla as unknown as Pool, mail);
    id = (await dosPasos.createChallenge('7', 'dana@example.com')).challengeId;
  });

  it('diez intentos a la vez solo prueban 3 códigos', async () => {
    const malo = String((Number(enviado) + 1) % 1_000_000).padStart(6, '0');
    const intentos = [...Array<string>(9).fill(malo), enviado];
    const resultados = await Promise.allSettled(
      intentos.map((c) => dosPasos.verify(id, c)),
    );
    expect(resultados.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('dos peticiones con el código bueno: solo una entra', async () => {
    const resultados = await Promise.allSettled([
      dosPasos.verify(id, enviado),
      dosPasos.verify(id, enviado),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

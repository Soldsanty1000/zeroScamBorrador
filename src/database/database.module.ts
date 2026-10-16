import { Module, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { createPool } from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import { loadEnv } from '../config';

export const DB_POOL = 'DB_POOL';

@Module({
  providers: [
    {
      provide: DB_POOL,
      useFactory: () => {
        // Cada quien tiene su propia base: la cadena de conexión vive en .env
        // (no se sube a git). Si no hay .env, se usa la variable del sistema.
        loadEnv();
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error(
            'Falta DATABASE_URL: copia .env.example a .env y pon tus datos',
          );
        }
        // Solo servidor y base: la cadena trae la contraseña y no va al log.
        try {
          const parsed = new URL(url);
          new Logger('Database').log(
            `Conectando a ${parsed.hostname}:${parsed.port || '3306'}${parsed.pathname}`,
          );
        } catch {
          new Logger('Database').log('Conectando a la base de datos');
        }
        // Pool acotado: sin esto una ráfaga de peticiones lentas (o una
        // consulta que se cuelga) bloquea toda la API.
        const pool = createPool({
          uri: url,
          connectionLimit: 10,
          queueLimit: 100,
          connectTimeout: 10_000,
        });
        // Ninguna consulta de lectura puede pasar de 10 s.
        pool.pool.on('connection', (connection) => {
          connection.query('SET SESSION max_execution_time = 10000');
        });
        return pool;
      },
    },
  ],
  exports: [DB_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  onModuleDestroy() {
    return this.pool.end();
  }
}

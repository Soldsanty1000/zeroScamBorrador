import { Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { createPool } from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import { existsSync } from 'node:fs';

export const DB_POOL = 'DB_POOL';

@Module({
  providers: [
    {
      provide: DB_POOL,
      useFactory: () => {
        // Cada quien tiene su propia base: la cadena de conexión vive en .env
        // (no se sube a git). Si no hay .env, se usa la variable del sistema.
        if (existsSync('.env')) process.loadEnvFile();
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error(
            'Falta DATABASE_URL: copia .env.example a .env y pon tus datos',
          );
        }
        console.log('Conectando a ' + url);
        return createPool({ uri: url });
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

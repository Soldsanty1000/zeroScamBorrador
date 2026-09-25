/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { FraudTypeDto, StatusDto } from './dto/catalogs-response.dto';

/**
 * Lectura de las tablas catálogo: `TipoFraude`, `Estado` y `Rol`.
 */
@Injectable()
export class CatalogsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** Tipos de fraude, por id. */
  async fraudTypes(): Promise<FraudTypeDto[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT id_tipo_fraude, nombre_tipo, descripcion FROM TipoFraude ORDER BY id_tipo_fraude',
    );
    return rows.map((row) => ({
      id: row.id_tipo_fraude,
      name: row.nombre_tipo,
      description: row.descripcion ?? undefined,
    }));
  }

  /** Estados de un reporte, en el orden del proceso. */
  async statuses(): Promise<StatusDto[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT id_estado, nombre_estado, descripcion, es_final, orden FROM Estado ORDER BY orden, id_estado',
    );
    return rows.map((row) => ({
      id: row.id_estado,
      name: row.nombre_estado,
      description: row.descripcion ?? undefined,
      // MySQL guarda BOOLEAN como TINYINT: llega 0 o 1.
      isFinal: Boolean(row.es_final),
      order: row.orden ?? undefined,
    }));
  }

  /** Nombres de los roles. */
  async roles(): Promise<string[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT nombre_rol FROM Rol ORDER BY id_rol',
    );
    return rows.map((row) => String(row.nombre_rol));
  }
}

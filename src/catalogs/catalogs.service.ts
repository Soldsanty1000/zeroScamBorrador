import { Injectable } from '@nestjs/common';
import { RISK_LEVELS } from '../common/constants';
import { CatalogsRepository } from './catalogs.repository';
import { CatalogsResponseDto } from './dto/catalogs-response.dto';

/**
 * Catálogos que la app necesita para llenar sus selectores sin tener los ids
 * escritos a mano.
 */
@Injectable()
export class CatalogsService {
  constructor(private readonly repository: CatalogsRepository) {}

  /** Todos los catálogos en una sola respuesta. */
  async findAll(): Promise<CatalogsResponseDto> {
    const [fraudTypes, statuses, roles] = await Promise.all([
      this.repository.fraudTypes(),
      this.repository.statuses(),
      this.repository.roles(),
    ]);
    return { fraudTypes, statuses, riskLevels: [...RISK_LEVELS], roles };
  }
}

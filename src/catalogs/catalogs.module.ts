import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CatalogsController } from './catalogs.controller';
import { CatalogsRepository } from './catalogs.repository';
import { CatalogsService } from './catalogs.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CatalogsController],
  providers: [CatalogsService, CatalogsRepository],
})
export class CatalogsModule {}

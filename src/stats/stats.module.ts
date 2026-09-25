import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { StatsController } from './stats.controller';
import { StatsRepository } from './stats.repository';
import { StatsService } from './stats.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [StatsController],
  providers: [StatsService, StatsRepository],
})
export class StatsModule {}

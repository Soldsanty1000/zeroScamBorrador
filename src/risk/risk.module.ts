import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { RiskController } from './risk.controller';
import { RiskRepository } from './risk.repository';
import { RiskService } from './risk.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RiskController],
  providers: [RiskService, RiskRepository],
  // ReportsModule lo usa para recalcular el riesgo de las URLs de un reporte.
  exports: [RiskService],
})
export class RiskModule {}

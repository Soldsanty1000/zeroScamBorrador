import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import {
  AccountExportController,
  CommunityController,
} from './community.controller';
import { CommunityRepository } from './community.repository';
import { CommunityService } from './community.service';

@Module({
  imports: [DatabaseModule, AuthModule, AccountModule, AnalyticsModule],
  controllers: [CommunityController, AccountExportController],
  providers: [CommunityService, CommunityRepository],
})
export class CommunityModule {}

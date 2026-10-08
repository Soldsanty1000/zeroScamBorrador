import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { RolesGuard } from './roles.guard';
import { TwoFactorService } from './two-factor.service';
import { UsersRepository } from './users.repository';

@Module({
  imports: [DatabaseModule, AnalyticsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersRepository,
    AuthGuard,
    RolesGuard,
    MailService,
    TwoFactorService,
  ],
  exports: [
    AuthGuard,
    RolesGuard,
    UsersRepository,
    AuthService,
    TwoFactorService,
  ],
})
export class AuthModule {}

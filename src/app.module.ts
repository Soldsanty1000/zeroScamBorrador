import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountModule } from './account/account.module';
import { AuditModule } from './audit/audit.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { CommunityModule } from './community/community.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { RiskModule } from './risk/risk.module';
import { StatsModule } from './stats/stats.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Tope general por IP: 120 peticiones por minuto. Login, registro, 2FA y
    // refresh llevan uno más estricto (ver auth.controller.ts).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      errorMessage: 'Demasiadas solicitudes. Intenta de nuevo en un momento.',
    }),
    AuditModule,
    AuthModule,
    UsersModule,
    ReportsModule,
    NotificationsModule,
    RiskModule,
    StatsModule,
    CatalogsModule,
    AccountModule,
    CommunityModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

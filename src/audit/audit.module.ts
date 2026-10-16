import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditService } from './audit.service';

/** Global: cualquier módulo puede inyectar {@link AuditService} sin importarlo. */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ContactsController } from './contacts.controller';
import { ContactsRepository } from './contacts.repository';
import { ContactsService } from './contacts.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ContactsController],
  providers: [ContactsService, ContactsRepository],
})
export class ContactsModule {}

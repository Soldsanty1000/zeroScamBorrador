import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ContactsModule } from './contacts/contacts.module';

@Module({
  imports: [AuthModule, ContactsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

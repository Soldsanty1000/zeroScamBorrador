import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Documentación OpenAPI. Se genera a partir de los decoradores de los
  // controllers y DTOs: Swagger UI en /docs, el documento crudo en /docs-json.
  const config = new DocumentBuilder()
    .setTitle('Agenda de contactos')
    .setDescription(
      'API de la agenda de contactos con autenticación JWT.\n\n' +
        'Para usar `/contacts`: registra un usuario en `POST /auth/register`, ' +
        'haz login en `POST /auth/login` y pega el `accessToken` en **Authorize**.',
    )
    .setVersion('1.0')
    .addTag('auth', 'Registro, login y renovación de tokens')
    .addTag('contacts', 'CRUD de contactos. Requiere Bearer token')
    .addTag('app', 'Salud del servidor')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(3000);
}
bootstrap();

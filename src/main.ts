import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Las fotos viven en uploads/ (fuera de src/). Express las sirve tal cual:
  // GET /uploads/<archivo> regresa el archivo con su Content-Type.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  // Documentación OpenAPI. Se genera a partir de los decoradores de los
  // controllers y DTOs: Swagger UI en /docs, el documento crudo en /docs-json.
  const config = new DocumentBuilder()
    .setTitle('ZeroScam')
    .setDescription(
      'API de reportes de fraude de ZeroScam con autenticación JWT.\n\n' +
        'Para usar `/reports`: registra un usuario en `POST /auth/register`, ' +
        'haz login en `POST /auth/login` y pega el `accessToken` en **Authorize**.',
    )
    .setVersion('1.0')
    .addTag('auth', 'Registro, login y renovación de tokens')
    .addTag('users', 'Perfil y gestión de cuentas (RF03)')
    .addTag('reports', 'Reportes de fraude. Requiere Bearer token')
    .addTag('notifications', 'Bandeja de notificaciones del usuario')
    .addTag('risk', 'Consulta de riesgo de URLs')
    .addTag('stats', 'Estadísticas para Administrador, Owner y Policía')
    .addTag('catalogs', 'Catálogos para llenar selectores de la app')
    .addTag(
      'account',
      'Cuenta de la app: perfil, preferencias, avatar y mis datos',
    )
    .addTag(
      'community',
      'Reportes vistos desde la app: feed, guardados, comentarios',
    )
    .addTag('app', 'Salud del servidor')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // El panel web sale de otro origen (http://localhost:3001): sin este
  // permiso el navegador no le deja leer las respuestas de la API.
  app.enableCors();

  // 0.0.0.0 = todas las interfaces de red, no solo localhost: así otra
  // máquina de la misma red puede abrir http://<tu-ip>:3000/uploads/...
  await app.listen(3000, '0.0.0.0');
  console.log('API en http://localhost:3000 y en ' + lanUrls().join(', '));
}

/** URLs por las que se llega a este servidor desde la red local. */
function lanUrls(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => 'http://' + i!.address + ':3000');
}

bootstrap();

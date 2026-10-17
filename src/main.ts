import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { jwtSecret } from './auth/jwt';

async function bootstrap() {
  // Sin llave para firmar tokens no tiene caso arrancar: falla aquí, con un
  // mensaje claro, y no en el primer login.
  jwtSecret();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // No anunciar "X-Powered-By: Express" (alerta de ZAP 10037).
  app.disable('x-powered-by');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Cabeceras de seguridad (alertas de ZAP 10038, 10020 y 10021): CSP,
  // X-Frame-Options y nosniff. Es una API JSON: no carga nada, así que la CSP es
  // mínima. Sin `useDefaults` helmet agregaría `style-src 'unsafe-inline'` y
  // fuentes `https:`/`data:` que no se usan. Solo /docs (Swagger UI) lleva una
  // política más laxa porque necesita sus propios scripts y estilos. Va antes de
  // Swagger y de /uploads para cubrir también esas rutas.
  const strict = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // El panel (otro puerto) muestra las fotos de /uploads con <img>: helmet
    // pondría `same-origin` y el navegador las bloquearía.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // El servidor habla HTTP: HSTS no aplica.
    hsts: false,
  });
  const forDocs = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        // El laboratorio sirve /docs por http: subir los recursos a https lo rompería.
        upgradeInsecureRequests: null,
      },
    },
    hsts: false,
  });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith('/docs')
      ? forDocs(req, res, next)
      : strict(req, res, next),
  );

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

  // Solo el panel puede leer las respuestas desde un navegador (alerta de ZAP
  // 10098). CORS_ORIGINS acepta varios orígenes separados por coma; en el
  // laboratorio es http://192.168.20.10:3001. La app de iOS no usa CORS.
  app.enableCors({
    origin: (
      process.env.CORS_ORIGINS ?? 'http://localhost:3001,http://127.0.0.1:3001'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  });

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

void bootstrap();

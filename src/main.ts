import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { AppModule } from './app.module';
import {
  corsOrigins,
  listenHost,
  listenPort,
  loadEnv,
  swaggerSettings,
  tlsFiles,
  validateConfig,
} from './config';

async function bootstrap() {
  loadEnv();
  // Sin JWT_SECRET ni EVIDENCE_KEY válidas el servidor no arranca.
  validateConfig();
  const tls = tlsFiles();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    httpsOptions: tls,
  });
  app.disable('x-powered-by');
  // Cierra el pool de MySQL y las conexiones al recibir SIGTERM/SIGINT.
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Cabeceras de seguridad (CSP, X-Frame-Options, nosniff, HSTS con TLS…).
  // La interfaz de Swagger necesita scripts y estilos propios, así que solo
  // esa ruta lleva una política más laxa; el resto de la API, la estricta.
  const strict = helmet({
    // Es una API JSON: no carga nada. Sin `useDefaults` helmet agregaría
    // `style-src 'unsafe-inline'` y fuentes `https:`/`data:` que no se usan.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: tls ? undefined : false,
  });
  const forDocs = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
      },
    },
    hsts: tls ? undefined : false,
  });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith('/docs')
      ? forDocs(req, res, next)
      : strict(req, res, next),
  );

  // Solo el panel autorizado (CORS_ORIGINS) puede leer respuestas desde un
  // navegador. La app de iOS no usa CORS.
  app.enableCors({
    origin: corsOrigins(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });

  // Documentación OpenAPI: Swagger UI en /docs, el documento crudo en
  // /docs-json. Fuera de producción está abierta; en producción solo si se
  // configuran SWAGGER_USER y SWAGGER_PASSWORD, y pide autenticación básica.
  const swagger = swaggerSettings();
  if (swagger.enabled) {
    if (swagger.user && swagger.password) {
      app.use(
        ['/docs', '/docs-json'],
        basicAuth(swagger.user, swagger.password),
      );
    }
    const config = new DocumentBuilder()
      .setTitle('ZeroScam')
      .setDescription(
        'API de reportes de fraude de ZeroScam con autenticación JWT.\n\n' +
          'Para usar `/reports`: registra un usuario en `POST /auth/register`, ' +
          'haz login en `POST /auth/login` y pega el `accessToken` en **Authorize**.',
      )
      .setVersion('1.0')
      .addTag('auth', 'Registro, login, renovación y cierre de sesión')
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
  }

  // Por defecto solo escucha en esta máquina (127.0.0.1). Para que un iPhone
  // o el panel de otra PC lleguen, define HOST=0.0.0.0 (y de preferencia TLS).
  const host = listenHost();
  const port = listenPort();
  await app.listen(port, host);
  const scheme = tls ? 'https' : 'http';
  console.log(`API en ${scheme}://${host}:${port}`);
  if (host === '0.0.0.0') {
    console.log('Accesible desde la red: ' + lanUrls(scheme, port).join(', '));
  }
}

/** Autenticación básica con comparación en tiempo constante. */
function basicAuth(user: string, password: string) {
  const expected = Buffer.from(`${user}:${password}`);
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const received = Buffer.from(
      header.startsWith('Basic ')
        ? Buffer.from(header.slice(6), 'base64').toString()
        : '',
    );
    if (
      received.length === expected.length &&
      timingSafeEqual(received, expected)
    ) {
      return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="ZeroScam docs"');
    res.status(401).send('Autenticación requerida');
  };
}

/** URLs por las que se llega a este servidor desde la red local. */
function lanUrls(scheme: string, port: number): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `${scheme}://${i!.address}:${port}`);
}

void bootstrap();

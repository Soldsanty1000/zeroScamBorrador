# Agenda de contactos — API

API REST de una agenda personal hecha con NestJS y MySQL. Cada usuario se
registra, entra con email y password, y administra sus contactos con un
token JWT.

Proyecto del curso **Seguridad informática** (TC2007B, Ago–Dic 2026). Se
construye por sesiones; cada sesión es una rama `sesion-NN-tema` que se
integra a `main` por pull request.

## Requisitos

- Node.js 20 o superior
- MySQL 8 corriendo en `localhost:3306`

## Cómo correr

```bash
npm install
cp .env.example .env               # y pon tu usuario/password de MySQL
mysql -u root -p < db/schema.sql     # crea la base `ZeroScam` (borra lo que haya)
npm run start:dev                     # http://localhost:3000
```

## Configuración

| Variable / valor | Dónde está hoy                      | Descripción                                |
|------------------|-------------------------------------|--------------------------------------------|
| `DATABASE_URL`   | `.env` (ver `.env.example`)         | Cadena de conexión a MySQL (base `ZeroScam`) |
| `SECRET`         | `src/auth/jwt.ts`                   | Llave HMAC con la que se firman los tokens |

`DATABASE_URL` va en `.env`, que no se sube a git: cada quien pone la de su
MySQL. `SECRET` sigue escrito en el código.

## Endpoints

Documentación interactiva en <http://localhost:3000/docs> (Swagger UI). El
documento OpenAPI crudo está en `/docs-json`. Para probar las rutas con
Bearer desde Swagger UI: haz login, copia el `accessToken` y pégalo en
**Authorize**, sin la palabra `Bearer`.

| Método | Ruta              | Auth   | Qué hace                                                 |
|--------|-------------------|--------|----------------------------------------------------------|
| GET    | `/`               | no     | Comprueba que el servidor responde (`Hello World!`)      |
| POST   | `/auth/register`  | no     | Crea un usuario (`name`, `lastName`, `country`, `email`, `password` ≥ 8 con un carácter especial) |
| POST   | `/auth/login`     | no     | Regresa `accessToken` (15 min) y `refreshToken` (7 días) |
| POST   | `/auth/refresh`   | no     | Access token nuevo a partir del refresh                  |
| POST   | `/reports`        | Bearer | Crea un reporte (`fraudTypeId`, `description`, `incidentDate`, `urls` ≥ 1). Solo rol Usuario |
| POST   | `/reports/:id/evidence` | Bearer | Sube un archivo de evidencia (campo `file`) a un reporte propio |

Las rutas con **Bearer** requieren `Authorization: Bearer <accessToken>`.
Sin él responden 401.

## Estructura

```
src/
├── main.ts              arranque, ValidationPipe global, Swagger en /docs
├── app.module.ts
├── common/              DTOs de respuestas de error (para Swagger)
├── database/            pool de MySQL (mysql2)
├── auth/                registro, login, refresh, guard y JWT a mano
├── reports/             controller → service → repository de reportes
└── contacts/            (sin usar: no hay tabla en el modelo ZeroScam)
db/schema.sql            modelo físico de ZeroScam + catálogos (Rol, Estado, TipoFraude)
```

## Flujo de trabajo

```bash
git switch -c sesion-NN-tema      # una rama por sesión
git commit -m "tipo: qué cambió y por qué"
git push -u origin sesion-NN-tema # y abrir pull request a main
```

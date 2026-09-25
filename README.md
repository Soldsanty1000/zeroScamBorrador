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
mysql -u root -p < db/schema.sql     # crea la base `agenda` (borra contactos existentes)
npm run start:dev                     # http://localhost:3000
```

## Configuración

| Variable / valor | Dónde está hoy                      | Descripción                                |
|------------------|-------------------------------------|--------------------------------------------|
| `DATABASE_URL`   | `src/database/database.module.ts`   | Cadena de conexión a MySQL                 |
| `SECRET`         | `src/auth/jwt.ts`                   | Llave HMAC con la que se firman los tokens |

Ambos están escritos en el código. Sacarlos a variables de entorno es parte
de una sesión posterior.

## Endpoints

Documentación interactiva en <http://localhost:3000/docs> (Swagger UI). El
documento OpenAPI crudo está en `/docs-json`. Para probar las rutas con
Bearer desde Swagger UI: haz login, copia el `accessToken` y pégalo en
**Authorize**, sin la palabra `Bearer`.

| Método | Ruta              | Auth   | Qué hace                                                 |
|--------|-------------------|--------|----------------------------------------------------------|
| GET    | `/`               | no     | Comprueba que el servidor responde (`Hello World!`)      |
| POST   | `/auth/register`  | no     | Crea un usuario (`email`, `password` ≥ 8)                |
| POST   | `/auth/login`     | no     | Regresa `accessToken` (15 min) y `refreshToken` (7 días) |
| POST   | `/auth/refresh`   | no     | Access token nuevo a partir del refresh                  |
| GET    | `/contacts`       | Bearer | Lista los contactos del usuario del token                |
| POST   | `/contacts`       | Bearer | Crea un contacto con el usuario del token como dueño     |
| GET    | `/contacts/:id`   | Bearer | Un contacto                                              |
| PATCH  | `/contacts/:id`   | Bearer | Edita campos parciales                                   |
| DELETE | `/contacts/:id`   | Bearer | Borra (204)                                              |

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
└── contacts/            controller → service → repository de contactos
db/schema.sql            tablas users y contacts
```

## Flujo de trabajo

```bash
git switch -c sesion-NN-tema      # una rama por sesión
git commit -m "tipo: qué cambió y por qué"
git push -u origin sesion-NN-tema # y abrir pull request a main
```

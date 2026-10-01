# ZeroScam — API

API REST de ZeroScam (0Fraude) hecha con NestJS y MySQL. Los ciudadanos
reportan fraudes y ofertas engañosas; la administración los valida y
clasifica; la Policía Cibernética consulta los reportes validados. Es el
backend de la app de iOS.

Proyecto del curso **Seguridad informática** (TC2007B, Ago–Dic 2026).

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

Si cambias `.env` con el servidor corriendo, reinícialo: el modo watch solo
recarga cuando cambia algo en `src/`.

### Cuentas de prueba

`db/schema.sql` crea una cuenta por rol de staff. Password de las tres:
`ZeroScam123!`. Las cuentas de rol Usuario se crean con `POST /auth/register`.

| Email                 | Rol           |
|-----------------------|---------------|
| `owner@zeroscam.mx`   | Owner         |
| `admin@zeroscam.mx`   | Administrador |
| `policia@zeroscam.mx` | Policia       |

## Configuración

| Variable / valor | Dónde está hoy                      | Descripción                                |
|------------------|-------------------------------------|--------------------------------------------|
| `DATABASE_URL`   | `.env` (ver `.env.example`)         | Cadena de conexión a MySQL (base `ZeroScam`) |
| `SECRET`         | `src/auth/jwt.ts`                   | Llave HMAC con la que se firman los tokens |

`DATABASE_URL` va en `.env`, que no se sube a git: cada quien pone la de su
MySQL. `SECRET` sigue escrito en el código.

## Roles

| Rol           | Qué puede hacer                                                        |
|---------------|------------------------------------------------------------------------|
| Usuario       | Crear, ver, editar y borrar **sus** reportes; subir evidencias          |
| Policia       | Ver reportes VALIDADO o CANALIZADO y sus estadísticas (solo lectura)    |
| Administrador | Ver todos los reportes, cambiar su estado y riesgo; gestionar cuentas   |
| Owner         | Lo mismo que Administrador, y además asignar roles                      |

El rol viaja dentro del access token (`role`). Si un rol no puede ver un
reporte, la API responde 404, igual que si no existiera.

## Endpoints

Documentación interactiva en <http://localhost:3000/docs> (Swagger UI). El
documento OpenAPI crudo está en `/docs-json`. Para probar las rutas con
Bearer desde Swagger UI: haz login, copia el `accessToken` y pégalo en
**Authorize**, sin la palabra `Bearer`.

| Método | Ruta                       | Rol                  | Qué hace |
|--------|----------------------------|----------------------|----------|
| GET    | `/`                        | —                    | Comprueba que el servidor responde (`Hello World!`) |
| GET    | `/catalogs`                | —                    | Tipos de fraude, estados, niveles de riesgo y roles |
| POST   | `/auth/register`           | —                    | Crea un usuario (`name`, `lastName`, `country`, `email`, `password` ≥ 8 con un carácter especial) |
| POST   | `/auth/login`              | —                    | Regresa `accessToken` (15 min) y `refreshToken` (7 días). 403 si la cuenta está suspendida |
| POST   | `/auth/refresh`            | —                    | Access token nuevo a partir del refresh |
| POST   | `/auth/logout`             | cualquiera           | 204; la app borra sus tokens |
| GET    | `/users/me`                | cualquiera           | Mi perfil |
| GET    | `/users`                   | Admin, Owner         | Lista cuentas (`?role=&accountStatus=&q=`) |
| GET    | `/users/:id`               | Admin, Owner         | Una cuenta |
| PATCH  | `/users/:id`               | Admin, Owner         | Edita o suspende (`accountStatus`); solo Owner cambia `role` |
| POST   | `/reports`                 | Usuario              | Crea un reporte (`fraudTypeId`, `description`, `incidentDate`, `urls` ≥ 1) |
| GET    | `/reports`                 | cualquiera           | Lista según el rol (`?status=&fraudTypeId=&from=&to=&q=&userId=`) |
| GET    | `/reports/:id`             | cualquiera           | Detalle con `history`; Admin/Owner reciben también `reporter` |
| PATCH  | `/reports/:id`             | Usuario (dueño)      | Edita mientras esté en RECIBIDO; `urls` reemplaza a las anteriores |
| DELETE | `/reports/:id`             | Usuario (dueño)      | Borra mientras esté en RECIBIDO, con sus evidencias |
| POST   | `/reports/:id/evidence`    | Usuario (dueño)      | Sube un archivo de evidencia (multipart, campo `file`) |
| PATCH  | `/reports/:id/status`      | Admin, Owner         | `EN_REVISION`, `VALIDADO`, `RECHAZADO` (exige `observations`) o `CANALIZADO` |
| PATCH  | `/reports/:id/risk`        | Admin, Owner         | Asigna `riskLevel`: BAJO, MEDIO, ALTO o MUY_ALTO |
| GET    | `/notifications`           | cualquiera           | Mis notificaciones (`?unread=true`) |
| PATCH  | `/notifications/:id/read`  | cualquiera           | Marca una notificación como leída |
| GET    | `/risk?q=`                 | cualquiera           | Riesgo de una URL o dominio y reportes validados anónimos |
| POST   | `/risk/analyze`            | cualquiera           | Analiza una URL (`url`): estructura, certificado, antigüedad del dominio y reportes; regresa `riskLevel`, `score` y el detalle |
| GET    | `/stats`                   | Admin, Owner, Policia | Conteos por estado, tipo, riesgo, país y mes; tasa de aprobación |

Las rutas con rol requieren `Authorization: Bearer <accessToken>`. Sin él
responden 401; con un rol sin acceso, 403.

### Ciclo de vida de un reporte

```
RECIBIDO ──► EN_REVISION ──► VALIDADO ──► CANALIZADO (final)
    │             │              │
    └─────────────┴──────────────┴──► RECHAZADO (final)
```

- Al crearse, cada Administrador y Owner recibe una notificación.
- Cada cambio de estado o de riesgo queda en `Historial_Estado`, y el
  denunciante recibe una notificación cuando cambia el estado.
- El riesgo de cada URL (`SitioWeb_URL.nivel_riesgo_global`) se recalcula
  con cada cambio de estado o de riesgo de sus reportes. Ver abajo.

### Riesgo de una URL

`POST /risk/analyze` corre cuatro verificaciones; cada una aporta puntos de
riesgo (0 a 100 en total) y cada 25 puntos sube un nivel: BAJO, MEDIO, ALTO,
MUY_ALTO.

| Verificación       | Qué revisa |
|--------------------|------------|
| `heuristics`       | Estructura de la URL: imita una marca, usa una IP, un `@`, punycode, muchos subdominios |
| `certificate`      | Certificado TLS: sin HTTPS, no confiable, vencido o muy reciente |
| `domainAge`        | Fecha de registro del dominio (RDAP; WHOIS para `.mx`) |
| `communityReports` | Reportes VALIDADO o CANALIZADO del mismo sitio |

- El nivel nunca queda por debajo del reporte validado más grave del sitio:
  la clasificación de la administración es un piso.
- El resultado se guarda en `SitioWeb_URL` (`nivel_riesgo_global`,
  `estado_certificado`, `fecha_ultima_evaluacion`, `detalle_evaluacion`).
  Analizar la misma URL antes de 24 horas regresa lo guardado
  (`cached: true`).
- Cuando cambian los reportes de un sitio, el nivel de sus URLs se vuelve a
  calcular con las verificaciones guardadas más los reportes actuales, sin
  conectarse otra vez al sitio. Si la URL nunca se analizó, su nivel sale
  solo de los reportes.

Si ya tienes la base creada, agrega la columna nueva sin borrar tus datos:

```sql
ALTER TABLE SitioWeb_URL ADD COLUMN detalle_evaluacion JSON NULL;
```

## Conectar la app de iOS

1. **URL base.** Al arrancar, el servidor imprime sus direcciones, p. ej.
   `API en http://localhost:3000 y en http://192.168.1.20:3000`. El
   simulador de iOS puede usar `http://localhost:3000`; un iPhone físico en
   la misma red Wi-Fi necesita la IP de la Mac.
2. **HTTP sin TLS.** iOS bloquea `http://` por App Transport Security. Para
   desarrollo agrega a `Info.plist`:
   ```xml
   <key>NSAppTransportSecurity</key>
   <dict>
     <key>NSAllowsLocalNetworking</key>
     <true/>
   </dict>
   ```
   Con eso basta para `localhost` y para IPs de la red local.
3. **Sesión.** `POST /auth/login` → guarda `accessToken` y `refreshToken`
   (en Keychain). Manda `Authorization: Bearer <accessToken>` en cada
   request. Si una ruta responde 401, llama `POST /auth/refresh` con el
   `refreshToken` y reintenta; si también falla, manda al login. Cerrar
   sesión = `POST /auth/logout` y borrar ambos tokens.
4. **Rol.** `GET /users/me` regresa el `role`: úsalo para decidir qué
   pantallas mostrar (Usuario, Policia, Administrador u Owner).
5. **Fechas.** Todas van en ISO 8601 con milisegundos
   (`2026-09-10T18:30:00.000Z`). El `.iso8601` de `JSONDecoder` no acepta
   milisegundos; usa un formateador propio:
   ```swift
   let formatter = ISO8601DateFormatter()
   formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
   let decoder = JSONDecoder()
   decoder.dateDecodingStrategy = .custom { d in
       let text = try d.singleValueContainer().decode(String.self)
       guard let date = formatter.date(from: text) else {
           throw DecodingError.dataCorrupted(.init(codingPath: d.codingPath,
               debugDescription: "Fecha inválida: \(text)"))
       }
       return date
   }
   ```
   Para mandar fechas (`incidentDate`) usa el mismo `formatter.string(from:)`.
6. **Selectores.** Llena el tipo de fraude con `GET /catalogs` (no requiere
   token) en vez de escribir los ids a mano.
7. **Crear un reporte con evidencias.** Primero `POST /reports` con JSON;
   con el `id` que regresa, sube cada archivo a
   `POST /reports/:id/evidence` como `multipart/form-data`, campo `file`.
   Las evidencias se ven en `<URL base><evidenceUrls[i]>`.
8. **Errores.** Siempre vienen como
   `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`. En
   errores de validación `message` es un arreglo de textos.
9. **Modelos generados.** Con `/docs-json` puedes generar el cliente y los
   modelos `Codable` con
   [swift-openapi-generator](https://github.com/apple/swift-openapi-generator)
   en vez de escribirlos a mano.

## Estructura

```
src/
├── main.ts              arranque, ValidationPipe global, Swagger en /docs
├── app.module.ts
├── common/              constantes de catálogos y DTOs de error
├── database/            pool de MySQL (mysql2), lee DATABASE_URL de .env
├── auth/                registro, login, refresh, logout, JWT a mano y roles
├── users/               perfil y gestión de cuentas
├── reports/             reportes, evidencias, estados y riesgo
├── notifications/       bandeja de notificaciones
├── risk/                consulta y análisis de riesgo por URL
├── stats/               estadísticas
├── catalogs/            catálogos para la app
└── contacts/            (sin usar: no hay tabla en el modelo ZeroScam)
db/schema.sql            modelo físico de ZeroScam + catálogos y cuentas de prueba
```

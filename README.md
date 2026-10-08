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
| `SAFE_BROWSING_API_KEY` | `.env` (opcional)            | Llave de Google Safe Browsing para las listas negras de `/risk/analyze` |
| `SMTP_URL`       | `.env` (opcional)                   | Servidor de correo para el código de dos pasos, p. ej. `smtp://localhost:1025` |
| `MAIL_FROM`      | `.env` (opcional)                   | Remitente de esos correos |
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
| GET    | `/health`                  | —                    | Estado del servicio para el monitor: 200 si la base responde, 503 si no |
| GET    | `/catalogs`                | —                    | Tipos de fraude, estados, niveles de riesgo y roles |
| POST   | `/auth/register`           | —                    | Crea un usuario (`name`, `lastName`, `country`, `email`, `password` ≥ 8 con un carácter especial, `acceptsPrivacy: true`) |
| POST   | `/auth/login`              | —                    | Regresa `accessToken` (15 min) y `refreshToken` (7 días). 403 si la cuenta está suspendida |
| POST   | `/auth/refresh`            | —                    | Access token nuevo a partir del refresh |
| POST   | `/auth/logout`             | cualquiera           | 204; la app borra sus tokens |
| PATCH  | `/auth/password`           | cualquiera           | Cambia mi password (`currentPassword`, `newPassword`); 204 |
| GET    | `/users/me`                | cualquiera           | Mi perfil |
| PATCH  | `/users/me`                | cualquiera           | Edita mi `name`, `lastName` o `country` |
| GET    | `/users`                   | Admin, Owner         | Lista cuentas (`?role=&accountStatus=&q=`) |
| GET    | `/users/:id`               | Admin, Owner         | Una cuenta |
| PATCH  | `/users/:id`               | Admin, Owner         | Edita o suspende (`accountStatus`); solo Owner cambia `role` |
| POST   | `/reports`                 | Usuario              | Crea un reporte (`fraudTypeId`, `description`, `incidentDate`, `urls` ≥ 1) |
| GET    | `/reports`                 | cualquiera           | Lista según el rol (`?status=&fraudTypeId=&from=&to=&q=&userId=`) |
| GET    | `/reports/:id`             | cualquiera           | Detalle con `history`; Admin/Owner reciben también `reporter` |
| GET    | `/reports/:id/export`      | Admin, Owner, Policia | Descarga el expediente (`<folio>.json`) de un reporte VALIDADO o CANALIZADO, para canalizarlo |
| PATCH  | `/reports/:id`             | Usuario (dueño)      | Edita mientras esté en RECIBIDO; `urls` reemplaza a las anteriores |
| DELETE | `/reports/:id`             | Usuario (dueño)      | Borra mientras esté en RECIBIDO, con sus evidencias |
| POST   | `/reports/:id/evidence`    | Usuario (dueño)      | Sube un archivo de evidencia (multipart, campo `file`) |
| PATCH  | `/reports/:id/status`      | Admin, Owner         | `EN_REVISION`, `VALIDADO`, `RECHAZADO` (exige `observations`) o `CANALIZADO` |
| PATCH  | `/reports/:id/risk`        | Admin, Owner         | Asigna `riskLevel`: BAJO, MEDIO, ALTO o MUY_ALTO |
| GET    | `/notifications`           | cualquiera           | Mis notificaciones (`?unread=true`); las alertas de riesgo traen `url` |
| PATCH  | `/notifications/:id/read`  | cualquiera           | Marca una notificación como leída |
| GET    | `/risk?q=`                 | cualquiera           | Riesgo de una URL o dominio y reportes validados anónimos |
| POST   | `/risk/analyze`            | cualquiera           | Analiza una URL (`url`): estructura, certificado, antigüedad del dominio y reportes; regresa `riskLevel`, `score` y el detalle |
| GET    | `/stats`                   | Admin, Owner, Policia | Conteos por estado, tipo, riesgo, país y mes; tasa de aprobación |
| GET    | `/stats/site`              | Admin, Owner         | Métricas de la plataforma: cuentas, URLs, consultas de riesgo y notificaciones (`?from=&to=`) |

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

`POST /risk/analyze` corre cinco verificaciones; cada una aporta puntos de
riesgo (0 a 100 en total) y cada 25 puntos sube un nivel: BAJO, MEDIO, ALTO,
MUY_ALTO.

| Verificación       | Qué revisa |
|--------------------|------------|
| `heuristics`       | Estructura de la URL: imita una marca, usa una IP, un `@`, punycode, muchos subdominios |
| `certificate`      | Certificado TLS: sin HTTPS, no confiable, vencido o muy reciente |
| `domainAge`        | Fecha de registro del dominio (RDAP; WHOIS para `.mx`) |
| `blacklist`        | Google Safe Browsing: phishing, malware, software no deseado |
| `communityReports` | Reportes VALIDADO o CANALIZADO del mismo sitio |

- El nivel nunca queda por debajo del reporte validado más grave del sitio:
  la clasificación de la administración es un piso.
- Una URL que aparece en la lista negra es MUY_ALTO sin importar lo demás.
  Esa verificación necesita `SAFE_BROWSING_API_KEY` en `.env`; sin la llave
  se omite (`"Lista negra no configurada"`) y las otras cuatro siguen.
- El resultado se guarda en `SitioWeb_URL` (`nivel_riesgo_global`,
  `estado_certificado`, `fecha_ultima_evaluacion`, `detalle_evaluacion`).
  Analizar la misma URL antes de 24 horas regresa lo guardado
  (`cached: true`).
- Cuando cambian los reportes de un sitio, el nivel de sus URLs se vuelve a
  calcular con las verificaciones guardadas más los reportes actuales, sin
  conectarse otra vez al sitio. Si la URL nunca se analizó, su nivel sale
  solo de los reportes.

### Alertas de riesgo (RF08)

- Cada `POST /risk/analyze` anota en `Consulta_URL` quién analizó qué URL.
- Cuando una URL **sube** a ALTO o MUY_ALTO (por un análisis nuevo o porque
  la administración validó o clasificó un reporte), reciben una notificación
  los usuarios activos que la analizaron o la reportaron en los últimos 30
  días. Quien provoca la subida al analizarla no recibe aviso: ya tiene el
  resultado.
- La notificación trae `url`. Para ver el detalle de la amenaza, la app la
  manda a `POST /risk/analyze`.
- Llegan a la bandeja (`GET /notifications`); la app debe consultarla. No hay
  notificaciones push.

Si ya tienes la base creada, agrega lo nuevo sin borrar tus datos:

```sql
ALTER TABLE SitioWeb_URL ADD COLUMN detalle_evaluacion JSON NULL;
ALTER TABLE Usuario ADD COLUMN fecha_consentimiento DATETIME NULL;
CREATE TABLE Consulta_URL (
  id_usuario     BIGINT   NOT NULL,
  id_url         BIGINT   NOT NULL,
  fecha_consulta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_usuario, id_url),
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
  FOREIGN KEY (id_url) REFERENCES SitioWeb_URL(id_url)
);
ALTER TABLE Notificacion_Alerta
  ADD COLUMN id_url BIGINT NULL AFTER id_reporte,
  ADD FOREIGN KEY (id_url) REFERENCES SitioWeb_URL(id_url);
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

## Rutas de la app de iOS

La app [0Fraude](https://github.com/alexrodrd/0Fraude-SwiftUI) usa las rutas
de arriba para sesión, notificaciones y moderación, y estas para lo que solo
existe en la app. Todas piden Bearer salvo `POST /account/register`. El
detalle de cada body está en `/docs` (tags `account` y `community`).

| Método | Ruta | Qué hace |
|--------|------|----------|
| POST   | `/auth/two-factor/verify`            | Segundo paso del login: `challengeId` + `code` → tokens |
| POST   | `/account/register`                  | Registro con `alias` (nombre público, único) |
| GET    | `/account`                           | Mi cuenta: perfil, alias, biografía, preferencias y consentimiento |
| PATCH  | `/account`                           | Edita mi perfil; cambiar el email pide `currentPassword` |
| PATCH  | `/account/preferences`               | Preferencias; apagar `twoStep` pide `password` |
| POST   | `/account/avatar`                    | Sube mi avatar (`multipart/form-data`, campo `file`, JPEG ≤ 5 MB) |
| DELETE | `/account/avatar`                    | Quita mi avatar |
| GET    | `/account/avatar/:id`                | Avatar de una cuenta (propio, de perfil público, o cualquiera si moderas) |
| GET    | `/account/export`                    | Descargar mis datos |
| DELETE | `/account`                           | Elimina mi cuenta; pide `password` |
| GET    | `/account/users`                     | Cuentas con su perfil de la app (Administrador, Owner) |
| GET    | `/account/analytics`                 | Contadores anónimos de uso (Owner) |
| GET    | `/community/reports`                 | `scope=feed` (públicos, con `q`, `types`, `minRisk`), `mine`, `saved` o `queue` |
| GET    | `/community/reports/:id`             | Detalle según quién mira |
| POST   | `/community/reports`                 | Crea un reporte con el formulario de la app (máx. 10 por día) |
| PATCH  | `/community/reports/:id`             | Edita uno propio en RECIBIDO o EN_REVISION |
| DELETE | `/community/reports/:id`             | Borra uno propio, o cualquiera si moderas |
| POST   | `/community/reports/:id/evidence`    | Adjunta JPEG (5 MB) o PDF (10 MB); máx. 3 |
| GET    | `/community/evidence/:id`            | Baja una evidencia (autor o quien modera) |
| PUT / DELETE | `/community/reports/:id/saved` | Guarda o quita de mis guardados |
| POST   | `/community/reports/:id/confirmations` | "Yo también" |
| GET / POST | `/community/reports/:id/comments` | Comentarios (máx. 5 por minuto) |
| DELETE | `/community/comments/:id`            | Borra un comentario propio, o cualquiera si moderas |
| GET    | `/community/reports/:id/history`     | Historial de estados (autor o quien modera) |
| GET    | `/community/users/:id`               | Perfil público de quien firmó un reporte (alias, biografía y sus reportes públicos no anónimos) |
| GET    | `/community/stats`                   | Números de la comunidad |
| GET    | `/community/categories`              | Reportes públicos por tipo de fraude |

Qué ve cada quien en `/community`: un reporte es visible si está VALIDADO o
CANALIZADO, si es propio, o si quien mira es Administrador u Owner; si no,
404. El autor aparece como su alias solo si tiene perfil público (o para
quien modera); si no, "Miembro de la comunidad" o "Anónimo". La persona
afectada y la evidencia solo llegan al autor y a quien modera.

**Verificación en dos pasos.** Si la cuenta la tiene encendida,
`POST /auth/login` responde `{ twoFactorRequired: true, challengeId,
destination, expiresAt }` en vez de tokens. El código de 6 dígitos dura 5
minutos, admite 3 intentos y se manda al correo registrado.

El correo sale por SMTP al servidor de `SMTP_URL`, sin pasar por internet.
Para desarrollo y para la red del equipo se usa
[Mailpit](https://mailpit.axllent.org) en la misma máquina que la API: recibe
cualquier correo, sea cual sea el dominio, y lo muestra en una página web.

```bash
brew install mailpit
# SMTP solo para esta máquina; la página, con usuario y contraseña
htpasswd -cbB mailpit-auth USUARIO CONTRASEÑA
mailpit --smtp 127.0.0.1:1025 --listen 0.0.0.0:8025 --ui-auth-file mailpit-auth
```

y en `.env`: `SMTP_URL=smtp://localhost:1025`. Los códigos se leen en
`http://<ip>:8025`. Sin `SMTP_URL` el código se imprime en la consola del
servidor (`Código de verificación para ...`). Si hay `SMTP_URL` pero el
servidor de correo no responde, el login contesta 503 y no se crea el
desafío.

**Eliminar la cuenta.** Los reportes ya públicos se quedan, anónimos y sin
evidencia ni persona afectada; lo demás se borra. La fila de `Usuario` queda
vacía con `estado_cuenta = 'ELIMINADA'` porque historial y comentarios la
referencian.

**Base ya creada.** Las columnas y tablas de la app se agregan sin borrar
datos con:

```bash
mysql -u root -p ZeroScam < db/migracion-app.sql
```

**Apuntar la app al servidor.** En Xcode, target PrototipoApp → Build
Settings: `ZS_FUENTE_DATOS = remote` y `ZS_URL_BASE = http://<ip>:3000`. La
app solo acepta HTTP hacia `localhost` o una IPv4 privada; cualquier otra URL
debe ser HTTPS.

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
├── health/              estado del servicio para el monitoreo
├── account/             cuenta de la app: perfil, preferencias, avatar
├── community/           reportes vistos desde la app: feed, guardados, comentarios
├── analytics/           contadores anónimos de uso
└── contacts/            (sin usar: no hay tabla en el modelo ZeroScam)
db/schema.sql            modelo físico de ZeroScam + catálogos y cuentas de prueba
db/migracion-app.sql     agrega lo de la app de iOS a una base ya creada
```

# Seguridad de la API

Este documento resume las mitigaciones del backend. El estado vulnerable anterior
se conserva en el tag git `antes-de-mitigar` como evidencia "antes de mitigar" del
reporte final (sección 7.1). Cada hallazgo de la auditoría tiene aquí su corrección y la forma
de comprobarla. Los IDs son los del reporte técnico de revisión: `V-xx` (lista
inicial) y `API-xx` (auditoría con agentes).

## Qué se corrigió

| Hallazgo | Corrección | Dónde |
|---|---|---|
| V-01, API-01, API-02 (inyección SQL) | Todas las consultas van parametrizadas (`?`, `IN (?)`, `LIKE` con comodines escapados); listas blancas para los fragmentos de SQL internos; validación de enteros. | `src/**/**.repository.ts`, `src/common/sql.ts` |
| V-02, API-17 (llave y JWT) | `JWT_SECRET` obligatoria (≥ 32 caracteres, se rechazan valores de ejemplo); verificación en tiempo constante, encabezado y claims validados (`iss`, `exp` numérico, `sid`), sin lanzar con basura. | `src/config.ts`, `src/auth/jwt.ts` |
| V-03, V-09 (contraseñas) | scrypt con sal por usuario (N=2^15); los hashes SHA-256 viejos se aceptan una vez y se reemplazan al iniciar sesión; las cuentas de staff nacen desactivadas y `npm run seed:staff` les genera contraseñas aleatorias fuera de git. | `src/auth/password.ts`, `scripts/seed-staff.mjs`, `db/schema.sql` |
| V-04, V-10, API-11 (fuerza bruta y enumeración) | Límite por IP (120/min global; 10/min en login, registro, 2FA y refresh; 5/min en cambio de contraseña), bloqueo progresivo por correo+IP, mismo mensaje y tiempo para correo inexistente y contraseña mala. | `src/app.module.ts`, `src/auth/login-attempts.ts`, `src/auth/auth.service.ts` |
| V-05, API-05, API-20 (sesiones y roles) | Tabla `Sesion`: cada login abre una sesión; cerrar sesión, cambiar contraseña o suspender la cuenta invalidan los tokens al instante; el rol y el estado salen de la base en cada petición; nadie se cambia el rol ni se suspende a sí mismo; siempre queda un Owner activo; solo el Owner edita cuentas de staff. | `src/auth/sessions.service.ts`, `src/auth/auth.guard.ts`, `src/users/users.service.ts` |
| V-06 (secretos en logs) | Ya no se escribe el token, la cadena de conexión ni el código de 2FA. En desarrollo, y solo con `DEV_LOG_2FA_CODES=true`, el código va a la consola. | `src/auth/auth.service.ts`, `src/database/database.module.ts`, `src/auth/mail.service.ts` |
| V-07 (dependencias) | `npm audit fix` y `nodemailer` 10: de 7 vulnerabilidades de producción (1 crítica, 3 altas) quedan 2 moderadas en `@nestjs/swagger`/`js-yaml`. La imagen de Docker ya no usa `--no-audit` y falla con vulnerabilidades altas. | `package.json`, `Dockerfile` |
| V-08, API-03, API-04 (evidencias) | `/uploads` ya no existe. La subida en `/reports` usa memoria, valida el contenido (JPEG o PDF), pone un nombre aleatorio y limita tamaño y cantidad; las evidencias se bajan solo por `GET /reports/:id/evidence/:archivo` (autenticado, quien puede ver el reporte) o `GET /community/evidence/:id`. | `src/common/files.ts`, `src/reports/reports.controller.ts` |
| V-14, API-10 (cifrado y limpieza) | Evidencias y avatares cifrados con AES-256-GCM (llave `EVIDENCE_KEY`); las fotos pierden EXIF/GPS/comentarios en el servidor; los PDF con scripts, archivos incrustados, formularios o cifrado se rechazan. | `src/common/files.ts`, `src/common/sanitize.ts` |
| V-11, V-12, V-13, V-16, API-24 (red y cabeceras) | Escucha en `127.0.0.1` salvo `HOST`; TLS opcional (`TLS_KEY_FILE`/`TLS_CERT_FILE`); CORS solo para `CORS_ORIGINS`; `helmet` (CSP, anti-clickjacking, nosniff, sin `X-Powered-By`); Swagger cerrado en producción salvo con usuario y contraseña. | `src/main.ts`, `src/config.ts` |
| V-15 (comparaciones) | `timingSafeEqual` en firma, hashes y códigos. | `src/auth/jwt.ts`, `src/auth/password.ts` |
| V-17 (código muerto) | Se eliminó el módulo `contacts` y su prueba. | — |
| V-18, API-22 (usuario de MySQL y Docker) | La API usa un usuario con SELECT/INSERT/UPDATE/DELETE, nunca root (`npm run setup:db` y `docker/02-privilegios.sh`); el contenedor corre sin root, con sistema de archivos de solo lectura, sin capacidades, con límites y red interna para la base. | `scripts/setup-db.mjs`, `docker-compose.yml`, `Dockerfile` |
| API-18 (2FA) | El contador de intentos es una sola sentencia atómica y el código se guarda con HMAC, no con SHA-256 simple. | `src/auth/two-factor.service.ts` |
| API-19 (bitácora) | Tabla `Auditoria`: inicios de sesión (ok, fallidos, bloqueados), cierres, cambios de contraseña, de rol y de estado de cuentas, y las acciones sobre reportes. Sin contraseñas, tokens ni textos libres. | `src/audit/audit.service.ts` |
| API-21 (correo) | Validación estricta del correo (sin comillas, espacios ni saltos de línea) y longitudes máximas en los DTO. | `src/common/validation.ts` |
| API-12 (recursos) | Pool de MySQL acotado, tiempo máximo por consulta, tope de filas en listados y límites de longitud en los DTO. | `src/database/database.module.ts` |
| API-06, API-07, API-08, API-09, API-13, API-14, API-16, API-25 | Ver la sección "Reglas de negocio y análisis de URLs" más abajo. | — |

## Reglas de negocio y análisis de URLs

(Se completa al integrar los cambios de los módulos `reports`, `community` y `risk`.)

## Cómo comprobarlo

```bash
npm test                      # pruebas unitarias
npm run build && npm run start:prod
```

Con la API en marcha puedes verificar a mano: cabeceras (`curl -I /health`),
que `/uploads/x` da 404, que un token firmado con otra llave da 401, que el
login se bloquea tras 5 fallos y que un token deja de valer al cerrar sesión.

## Riesgos que quedan (y por qué)

- **Los tokens siguen en `localStorage` en el panel.** Una cookie `httpOnly`
  exigiría rediseñar el flujo de sesión; se compensa con CSP, tokens de 15
  minutos y revocación real en servidor.
- **HTTP por defecto.** Sin certificado no hay TLS; para usar la API desde un
  iPhone por la red hay que configurar `TLS_KEY_FILE`/`TLS_CERT_FILE`.
- **El límite de intentos de login vive en la memoria del proceso.** Con varias
  instancias haría falta guardarlo en la base.
- **API-15 (correo sin verificar).** Registro y cambio de correo no envían un
  enlace de confirmación; requiere un flujo nuevo de correo y pantallas.
- **API-23 (esquema).** `schema.sql` sigue borrando las tablas (`npm run setup:db` exige
  `CONFIRMAR_BORRADO=si`); falta migrar a
  un sistema de migraciones, agregar `CHECK` y un `UNIQUE` sobre el hash de la URL.
- **Los PDF se revisan por texto, no dentro de flujos comprimidos.** No sustituye
  a un antivirus.
- **`@nestjs/swagger` arrastra 2 avisos moderados de `js-yaml`** que solo se
  corrigen con una actualización mayor; Swagger está cerrado en producción.

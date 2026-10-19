# ZeroScam completo en Docker

Un solo comando levanta todo, cada pieza en su propio contenedor:

| Servicio  | Qué es                                   | En esta PC              |
| --------- | ---------------------------------------- | ----------------------- |
| `db`      | MySQL 8.4 con `db/schema.sql` cargado    | `localhost:3307`        |
| `api`     | Esta API (NestJS)                        | http://localhost:3000 (Swagger en `/docs`) |
| `admin`   | Panel web ([zeroscam-admin](https://github.com/Soldsanty1000/zeroscam-admin)) | http://localhost:3001 |
| `mailpit` | Recibe los correos con el código de 2 pasos | http://localhost:8025 |

## Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado y abierto.
- Git, y acceso al repo del panel (es privado).

## Instalar en una PC nueva

Clona los dos repos **en la misma carpeta**:

```bash
git clone https://github.com/Soldsanty1000/zeroScamBorrador.git
git clone https://github.com/Soldsanty1000/zeroscam-admin.git
cd zeroScamBorrador
cp .env.example .env          # en Windows: copy .env.example .env
```

Edita `.env` y cambia `MYSQL_ROOT_PASSWORD` (solo letras y números). Si
clonaste el panel con otro nombre de carpeta, ajusta `ADMIN_PATH`. Luego:

```bash
docker compose up -d --build
```

La primera vez tarda unos minutos. Abre http://localhost:3001 y entra con una
de las cuentas de prueba del [README](README.md#cuentas-de-prueba).

## Día a día

```bash
docker compose ps                  # estado de cada contenedor
docker compose logs -f api         # logs de la API
docker compose down                # apagar (los datos se conservan)
docker compose up -d               # volver a prender
git pull && docker compose up -d --build   # actualizar (haz pull también en zeroscam-admin)
```

## Datos

La base, las evidencias (`uploads/`) y los avatares viven en volúmenes de
Docker: sobreviven a `down`, a reinicios y a actualizaciones.

- **Empezar de cero** (borra TODO, vuelve a cargar `db/schema.sql`):
  `docker compose down -v && docker compose up -d`
- **Migraciones** sobre una base ya creada (cada una se corre una vez, en orden):
  `docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" ZeroScam' < db/migracion-app.sql`
  y lo mismo con `db/migracion-scrypt.sql` y `db/migracion-idempotencia.sql`.
- **Respaldo**:
  `docker compose exec db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" ZeroScam' > respaldo.sql`

`db/schema.sql` solo se carga la primera vez, cuando el volumen está vacío.
`MYSQL_ROOT_PASSWORD` también se fija esa primera vez: cambiarlo después en
`.env` no cambia el de la base (haz `down -v` o cámbialo dentro de MySQL).

## Usar el panel o la app desde otras PCs de la red

La API escucha en todas las interfaces, así que la app de iOS o el panel en
otra PC llegan a `http://<IP-de-esta-PC>:3000`. Para el panel, la URL de la
API queda fija al construirlo: pon en `.env`
`NEXT_PUBLIC_API_URL=http://<IP-de-esta-PC>:3000` y corre
`docker compose up -d --build`.

MySQL y Mailpit solo se abren en esta PC (`127.0.0.1`), no en la red.

## Opcional

- `SAFE_BROWSING_API_KEY` en `.env` activa la verificación de listas negras.
- Para usar la API sin Docker (`npm run start:dev`) sigue el README; las
  variables de Docker en `.env` no le afectan.

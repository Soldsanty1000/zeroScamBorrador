# Despliegue en las PCs del proyecto (Windows + Docker Desktop)

| PC | VLAN | IP | Corre |
|---|---|---|---|
| Base de datos | 10 · `192.168.10.0/24` | `192.168.10.10` | MySQL 8.4 (`deploy/db`), puerto 3306 |
| Back | 20 · `192.168.20.0/24` | `192.168.20.10` (fija: tiene el NAT a `200.0.0.50`) | API :3000, panel :3001, Mailpit :8025 (`deploy/back`) |

Los iPhones entran por la Wi-Fi (VLAN 30, `192.168.30.0/24`) y llegan al back por OSPF.

## 0. En las dos PCs

1. **IP fija** (Configuración → Red → Ethernet → Editar asignación de IP):
   - Base: `192.168.10.10`, máscara `255.255.255.0`, puerta `192.168.10.1`, DNS `8.8.8.8`.
   - Back: `192.168.20.10`, máscara `255.255.255.0`, puerta `192.168.20.1`, DNS `8.8.8.8`.
2. **Docker Desktop** instalado y abierto (la ballena en la barra de tareas en verde). En Settings → General activa *Start Docker Desktop when you sign in*. Los contenedores tienen `restart: unless-stopped`: vuelven a arrancar solos cuando Docker abre.
3. Los comandos van en **PowerShell**. Los de firewall, en PowerShell **como administrador**.

## 1. PC de la base de datos

```powershell
git clone https://github.com/Soldsanty1000/zeroScamBorrador.git
cd zeroScamBorrador\deploy\db
copy .env.example .env
notepad .env
```

En `.env` pon `MYSQL_ROOT_PASSWORD` y `MYSQL_APP_PASSWORD` (solo letras y números) y `MYSQL_BIND=0.0.0.0` (con la IP fija puede ir `192.168.10.10`, pero en Docker Desktop a veces falla). Root solo entra desde dentro del contenedor; por la red solo entra `zeroscam`. Sin Git: GitHub → Code → Download ZIP.

```powershell
docker compose up -d
docker compose ps        # espera a que diga (healthy), ~1 min la primera vez
```

La primera vez carga `db/schema.sql` con las cuentas de prueba y crea el usuario `zeroscam`.

Firewall (como administrador): 3306 solo desde la PC del back.

```powershell
New-NetFirewallRule -DisplayName "ZeroScam MySQL" -Direction Inbound -Protocol TCP -LocalPort 3306 -RemoteAddress 192.168.20.10 -Action Allow
New-NetFirewallRule -DisplayName "ZeroScam ping" -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -Action Allow
```

Si Windows muestra un aviso de firewall para Docker, elige **solo redes privadas** o cancela: la regla de arriba ya basta. Si aceptas para todas las redes, el 3306 queda abierto a cualquiera.

## 2. PC del back

Los dos repos juntos en la misma carpeta:

```powershell
git clone https://github.com/Soldsanty1000/zeroScamBorrador.git
git clone https://github.com/Soldsanty1000/zeroscam-admin.git
cd zeroScamBorrador\deploy\back
copy .env.example .env
notepad .env
```

El panel es privado: Git pedirá iniciar sesión con una cuenta con acceso (o bájalo en ZIP y pon `ADMIN_PATH=../../../zeroscam-admin-main`).

En `.env`: `DB_HOST=192.168.10.10`, `DB_PORT` igual a `MYSQL_PORT` de la base, `MYSQL_APP_PASSWORD` idéntica a la de la base (letra por letra, incluido cualquier punto), `NEXT_PUBLIC_API_URL=http://192.168.20.10:3000` y `BIND=192.168.20.10`.

`JWT_SECRET` es la llave que firma las sesiones. La API no arranca sin ella. Genérala una vez en PowerShell y pégala en `.env`:

```powershell
$b = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

Si cambia, todas las sesiones abiertas se cierran (hay que volver a iniciar sesión).

Sin internet en la red del proyecto, compila **antes** de cambiarte a ella (con internet): `docker compose pull mailpit` y `docker compose build`. Ya en la red del proyecto, `docker compose up -d` **sin** `--build`. Si el build se queda en *resolving provenance*: `$env:BUILDX_NO_DEFAULT_ATTESTATIONS=1` y vuelve a compilar.

```powershell
Test-NetConnection 192.168.10.10 -Port 3306   # TcpTestSucceeded : True
docker compose up -d --build                   # la primera vez tarda varios minutos
docker compose ps
```

Firewall (como administrador):

```powershell
New-NetFirewallRule -DisplayName "ZeroScam API y panel" -Direction Inbound -Protocol TCP -LocalPort 3000,3001 -Action Allow
New-NetFirewallRule -DisplayName "ZeroScam ping" -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -Action Allow
```

Listo:

- Panel: <http://192.168.20.10:3001>
- API: <http://192.168.20.10:3000/health> (Swagger en `/docs`)
- Códigos de dos pasos: <http://localhost:8025> en la PC del back. Para verlos desde otra PC, `MAILPIT_BIND=0.0.0.0` en `.env`, `docker compose up -d` y abre el 8025 en el firewall.

## Internet en el back (Wi-Fi USB + cable del proyecto)

El diagnóstico de URLs revisa certificados, antigüedad del dominio (rdap.org) y Google Safe Browsing: el back necesita internet. La red del proyecto no tiene, así que el back usa dos adaptadores: el cable para el proyecto y una Wi-Fi USB para internet. Windows no reenvía tráfico entre ellos (no hace de puente).

PowerShell como administrador, con la Wi-Fi ya conectada:

```powershell
# El cable sin puerta de enlace ni DNS: internet sale por la Wi-Fi
Remove-NetRoute -InterfaceAlias "Ethernet" -DestinationPrefix 0.0.0.0/0 -Confirm:$false
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ResetServerAddresses
# Rutas a la base y a la Wi-Fi del proyecto por el cable
route -p add 192.168.10.0 mask 255.255.255.0 192.168.20.1
route -p add 192.168.30.0 mask 255.255.255.0 192.168.20.1
# Firewall prendido; API y panel solo por el cable
Set-NetFirewallProfile -All -Enabled True
Get-NetFirewallRule -DisplayName "ZeroScam*" | Set-NetFirewallRule -InterfaceAlias "Ethernet"
w32tm /resync
```

Con `BIND=192.168.20.10` en `.env`, Docker publica la API y el panel solo en el cable: desde la Wi-Fi de la escuela no responden. Comprobar que Windows no reenvía entre redes (solo debe salir `vEthernet (WSL)`):

```powershell
Get-NetIPInterface -AddressFamily IPv4 | Where-Object Forwarding -eq Enabled | Select InterfaceAlias
```

Desconecten la Wi-Fi cuando no haga falta y avisen a TI / al profesor antes de escanear el backend con otras herramientas.

## 3. App de iOS

En Xcode: `ZS_URL_BASE = http://192.168.20.10:3000` y `ZS_FUENTE_DATOS = remote` (Debug y Release). El iPhone en la Wi-Fi del proyecto.

No uses `http://200.0.0.50:3000`: es la IP "pública" del NAT y la app solo acepta HTTP hacia IPs privadas.

## Cuentas de prueba

Password `ZeroScam123!`: `owner@zeroscam.mx`, `admin@zeroscam.mx`, `policia@zeroscam.mx`, `ana@zeroscam.mx`, `beto@zeroscam.mx`.

## Migración de contraseñas (una sola vez)

Desde el cambio a scrypt, la API ya no acepta los hashes SHA-256 de antes. Si la base se creó antes de ese cambio, después de actualizar la API corre en la PC de la base (dentro de la carpeta del repo):

```powershell
Get-Content db\migracion-scrypt.sql | docker exec -i zeroscam-db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" ZeroScam'
```

Actualiza las cuentas de arranque (owner, admin y policía, password `ZeroScam123!`) y lista las que sigan con el hash viejo: esas tienen que registrarse otra vez.

## Migración de idempotencia (una sola vez)

La app de iOS guarda los reportes hechos sin conexión y los reenvía con la cabecera `Idempotency-Key` para no duplicarlos. Si la base se creó antes de ese cambio, después de actualizar la API corre en la PC de la base (dentro de la carpeta del repo):

```powershell
Get-Content db\migracion-idempotencia.sql | docker exec -i zeroscam-db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" ZeroScam'
```

Solo agrega la tabla `Reporte_Idempotencia`; no toca datos y se puede correr más de una vez. Sin ella, crear un reporte con esa cabecera falla.

## Día a día

| Quiero… | Dónde | Comando |
|---|---|---|
| Actualizar el código | back | `git pull` en los dos repos y `docker compose up -d --build` en `deploy\back` |
| Ver logs | back | `docker compose logs -f api` (o `admin`) |
| Cambió la IP del back | back | Cambia `NEXT_PUBLIC_API_URL` y `docker compose up -d --build` (va dentro del panel) |
| Apagar / prender | cualquiera | `docker compose down` / `docker compose up -d` (los datos se conservan) |
| Respaldo | base | `docker exec zeroscam-db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" ZeroScam' > respaldo.sql` |
| Borrar todo y volver a los datos de prueba | base | `docker compose down -v` y `docker compose up -d` (**borra todos los datos**) |

## Si algo falla

| Síntoma | Revisa |
|---|---|
| `Test-NetConnection` al 3306 falla | `ping 192.168.10.10`. Sin ping: red (VLAN, OSPF, puerta de enlace). Con ping: `docker compose ps` en la base y la regla de firewall. |
| La API responde 500 o el log dice `Access denied` | `MYSQL_APP_PASSWORD` distinta en las dos PCs. Si cambiaste la de la base después del primer arranque, no se aplicó: `docker compose down -v` y arriba de nuevo (borra datos). |
| El panel abre pero no inicia sesión | `NEXT_PUBLIC_API_URL` mal; corrige y `docker compose up -d --build`. |
| `docker compose` dice que no encuentra Docker | Abre Docker Desktop y espera a que esté en verde. |
| Docker Desktop pide WSL o virtualización | Instala WSL (`wsl --install` como administrador, reinicia) y activa la virtualización (VT-x/SVM) en la BIOS. |
| `Test-NetConnection` falla y el ping da `DestinationHostUnreachable` | Router o switches sin configuración (se borra si no se guardó): `copy running-config startup-config` en los tres. |
| La base no arranca: `Intento de acceso a un socket no permitido` | Windows tiene ocupado o reservado ese puerto. Usa otro (`MYSQL_PORT=3006`) y pon el mismo en `DB_PORT` del back y en la regla de firewall de la base. |
| La base no arranca: `cannot assign requested address` | `MYSQL_BIND` no es la IP de esta PC (`ipconfig`). Corrígela, o pon `0.0.0.0`. |
| El iPhone no conecta | Safari en el iPhone: `http://192.168.20.10:3000/health`. |

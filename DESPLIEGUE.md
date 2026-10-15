# Despliegue en las PCs del proyecto (Windows, sin Docker)

Dos PCs de escritorio con Windows 10/11, conectadas al switch de servidores:

| PC | VLAN | IP | Corre |
|---|---|---|---|
| Base de datos | 10 · `192.168.10.0/24` | `192.168.10.10` (la que tenga) | MySQL 8.4, puerto 3306 |
| Back | 20 · `192.168.20.10/24` | `192.168.20.10` (fija: tiene el NAT a `200.0.0.50`) | API :3000 y panel :3001 |

Los iPhones entran por la red inalámbrica (VLAN 30, `192.168.30.0/24`) y llegan al back por OSPF.

Todo se instala con dos scripts de `deploy/windows/`. No hace falta instalar nada a mano: descargan MySQL y Node solos (las PCs necesitan internet la primera vez).

## 0. Antes de empezar

- Pon IP fija en cada PC (Configuración → Red → Ethernet → Editar asignación de IP):
  - Base: `192.168.10.10`, máscara `255.255.255.0`, puerta `192.168.10.1`, DNS `8.8.8.8`.
  - Back: `192.168.20.10`, máscara `255.255.255.0`, puerta `192.168.20.1`, DNS `8.8.8.8`.
- Elige dos passwords de **solo letras y números**, mínimo 8: una para `root` de MySQL y otra para el usuario `zeroscam` (la app la usa para conectarse).

## 1. PC de la base de datos

1. Descarga este repo (público): en GitHub → **Code → Download ZIP**, y descomprímelo (por ejemplo en `Documentos`).
2. Abre `deploy\windows` y da doble clic en **`1-base-de-datos.cmd`**. Acepta el permiso de administrador.
3. Escribe las dos passwords.

El script instala MySQL en `C:\ZeroScam\mysql` como servicio **ZeroScamDB** (arranca solo con Windows), carga `db/schema.sql` con las cuentas de prueba, crea el usuario `zeroscam` que **solo** puede entrar desde `192.168.20.10` y abre el 3306 en el firewall solo para esa IP.

Si el back no tiene `192.168.20.10`, córrelo desde PowerShell como administrador con su IP:

```powershell
.\base-de-datos.ps1 -IpBack 192.168.20.25
```

## 2. PC del back

1. Pon los **dos** repos en la misma carpeta, uno junto al otro:
   ```
   Documentos\
     zeroScamBorrador\      (este repo)
     zeroscam-admin\        (el panel)
   ```
   El panel es privado: descárgalo en ZIP desde GitHub con una cuenta que tenga acceso, o cópialo con USB. También sirve `git clone` si la PC tiene Git.
2. Abre `zeroScamBorrador\deploy\windows` y da doble clic en **`2-back.cmd`**.
3. Escribe la IP de la base (Enter = `192.168.10.10`) y la password de `zeroscam`.

El script instala Node 22 en `C:\ZeroScam\node`, compila la API y el panel y crea dos tareas de Windows, **ZeroScam API** y **ZeroScam Panel**, que arrancan solas al prender la PC y se reinician si se caen. Abre los puertos 3000 y 3001.

Al final muestra:

- Panel: <http://192.168.20.10:3001>
- API: <http://192.168.20.10:3000> (Swagger en `/docs`, estado en `/health`)

## 3. App de iOS

En Xcode, `ZS_URL_BASE = http://192.168.20.10:3000` y `ZS_FUENTE_DATOS = remote` (en Debug y Release). El iPhone debe estar en la Wi-Fi del proyecto.

No uses `http://200.0.0.50:3000`: es la IP "pública" del NAT y la app solo acepta HTTP hacia IPs privadas.

## Cuentas de prueba

Las que crea `schema.sql` (password `ZeroScam123!`): `owner@zeroscam.mx`, `admin@zeroscam.mx`, `policia@zeroscam.mx`, `ana@zeroscam.mx`, `beto@zeroscam.mx`.

El panel pide un código de verificación al entrar. Sin servidor de correo, el código se escribe en `C:\ZeroScam\logs\api.log` de la PC del back (solo administradores pueden leer `C:\ZeroScam`; abre PowerShell como administrador):

```powershell
Get-Content C:\ZeroScam\logs\api.log -Tail 20 -Wait
```

## Día a día

| Quiero… | Cómo |
|---|---|
| Actualizar el código | Bajar la versión nueva de los repos y volver a correr `2-back.cmd`. Recompila y reinicia. |
| Cambiar IP de la base o password | `.\back.ps1 -Reconfigurar` en PowerShell como administrador. |
| El back cambió de IP | Volver a correr `2-back.cmd` (el panel lleva la IP de la API dentro y se recompila) y `.\base-de-datos.ps1 -IpBack <nueva>` en la base. |
| Reiniciar API o panel | Reiniciar la PC, o volver a correr `2-back.cmd`. |
| Ver errores | `C:\ZeroScam\logs\api.log` y `panel.log`. |
| Borrar todo y volver a los datos de prueba | En la base: `.\base-de-datos.ps1 -Reiniciar` (**borra todos los datos**). |
| Respaldo | En la base: `C:\ZeroScam\mysql\bin\mysqldump -uroot -p ZeroScam > respaldo.sql` |

## Si algo falla

| Síntoma | Revisa |
|---|---|
| `2-back.cmd` dice que no hay conexión con MySQL | Desde el back: `Test-NetConnection 192.168.10.10 -Port 3306`. Si falla, `ping 192.168.10.10`: si el ping tampoco pasa es la red (VLAN, OSPF, puerta de enlace); si el ping pasa, el servicio ZeroScamDB o el firewall de la base. |
| La API arranca pero responde 500 | `api.log`: `Access denied` = password de `zeroscam` distinta en las dos PCs, o el back no tiene la IP que se le dio a la base. |
| El panel abre pero no inicia sesión | Se compiló con otra IP de API. Vuelve a correr `2-back.cmd`. |
| El iPhone no conecta | Que esté en la Wi-Fi de la VLAN 30 y que en Safari abra `http://192.168.20.10:3000/health`. |
| Windows bloquea el `.cmd` | Clic derecho → Propiedades → Desbloquear, o "Más información → Ejecutar de todas formas". |

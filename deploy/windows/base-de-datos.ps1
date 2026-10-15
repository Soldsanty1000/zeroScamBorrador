# ZeroScam - PC de BASE DE DATOS (Windows, sin Docker).
#
# Instala MySQL 8.4 como servicio de Windows ("ZeroScamDB"), carga
# db/schema.sql la primera vez, crea el usuario `zeroscam` que solo puede
# entrar desde la PC del back y abre el puerto 3306 solo para esa IP.
#
# Uso: doble clic en 1-base-de-datos.cmd (pide permisos de administrador).
# Se puede volver a correr: no borra datos salvo con -Reiniciar.

param(
  [string]$IpBack = '192.168.20.10',
  [string]$Version = '8.4.8',
  [string]$Raiz = 'C:\ZeroScam',
  # Vuelve a cargar schema.sql: BORRA todas las tablas y sus datos.
  [switch]$Reiniciar
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Paso($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Falla($texto) { Write-Host "`nERROR: $texto" -ForegroundColor Red; Read-Host 'Enter para salir'; exit 1 }

$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) { Falla 'Abre este script como administrador (usa 1-base-de-datos.cmd).' }

$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$schema = Join-Path $repo 'db\schema.sql'
if (-not (Test-Path $schema)) { Falla "No encuentro $schema" }

$mysqlDir = Join-Path $Raiz 'mysql'
$dataDir = Join-Path $Raiz 'mysql-data'
$ini = Join-Path $Raiz 'my.ini'
$bin = Join-Path $mysqlDir 'bin'
$servicio = 'ZeroScamDB'
New-Item -ItemType Directory -Force $Raiz | Out-Null
# C:\ deja que cualquier usuario modifique carpetas nuevas; aqui hay archivos que
# corren como SYSTEM. Solo SYSTEM (S-1-5-18) y Administradores (S-1-5-32-544).
icacls $Raiz /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /Q | Out-Null
if ($LASTEXITCODE -ne 0) { Falla "No se pudieron fijar los permisos de $Raiz" }

Write-Host 'ZeroScam - instalacion de la base de datos' -ForegroundColor Green
Write-Host "Solo la PC del back ($IpBack) podra conectarse."

# Las passwords van dentro de DATABASE_URL: solo letras y numeros.
function Pedir($texto) {
  while ($true) {
    $valor = Read-Host $texto
    if ($valor -match '^[A-Za-z0-9]{8,}$') { return $valor }
    Write-Host 'Minimo 8 caracteres, solo letras y numeros.' -ForegroundColor Yellow
  }
}
$rootPass = Pedir 'Password de root de MySQL (nueva, o la que ya tiene si ya se instalo)'
$appPass = Pedir 'Password del usuario zeroscam (la misma se pone en la PC del back)'

Paso 'Visual C++ Redistributable (MySQL lo necesita)'
$vc = Join-Path $env:TEMP 'vc_redist.x64.exe'
curl.exe -L --fail -o $vc 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
if ($LASTEXITCODE -ne 0) { Falla 'No se pudo descargar vc_redist. Revisa el internet de esta PC.' }
Start-Process $vc -ArgumentList '/install', '/quiet', '/norestart' -Wait

if (-not (Test-Path (Join-Path $bin 'mysqld.exe'))) {
  Paso "Descargando MySQL $Version (unos 250 MB)"
  $zip = Join-Path $env:TEMP "mysql-$Version-winx64.zip"
  if (-not (Test-Path $zip)) {
    curl.exe -L --fail -o $zip "https://cdn.mysql.com/archives/mysql-8.4/mysql-$Version-winx64.zip"
    if ($LASTEXITCODE -ne 0) { Remove-Item $zip -ErrorAction SilentlyContinue; Falla 'No se pudo descargar MySQL.' }
  }
  Paso 'Descomprimiendo'
  $tmp = Join-Path $Raiz 'mysql-tmp'
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $zip $tmp
  Move-Item (Get-ChildItem $tmp)[0].FullName $mysqlDir
  Remove-Item $tmp -Recurse -Force
}

# Rutas con / : MySQL las lee igual en Windows y no hay que escapar nada.
# Sin BOM: MySQL no entiende un my.ini en UTF-8 con BOM.
$conf = @"
[mysqld]
basedir=$($mysqlDir -replace '\\', '/')
datadir=$($dataDir -replace '\\', '/')
port=3306
bind-address=0.0.0.0
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci

[client]
default-character-set=utf8mb4
"@
[IO.File]::WriteAllText($ini, $conf, (New-Object Text.UTF8Encoding $false))

$nueva = -not (Test-Path $dataDir)
if ($nueva) {
  Paso 'Inicializando la base (root sin password por ahora)'
  & "$bin\mysqld.exe" "--defaults-file=$ini" --initialize-insecure --console
  if ($LASTEXITCODE -ne 0) { Falla 'mysqld --initialize fallo.' }
}

if (-not (Get-Service $servicio -ErrorAction SilentlyContinue)) {
  Paso "Registrando el servicio $servicio (arranca solo con Windows)"
  & "$bin\mysqld.exe" --install $servicio "--defaults-file=$ini"
  if ($LASTEXITCODE -ne 0) { Falla 'No se pudo registrar el servicio.' }
}
Paso 'Arrancando MySQL'
Restart-Service $servicio
$env:MYSQL_PWD = if ($nueva) { '' } else { $rootPass }
# En PowerShell 5 un 2>$null de un .exe cuenta como error y con 'Stop' corta el script.
$ErrorActionPreference = 'Continue'
for ($i = 0; $i -lt 30; $i++) {
  & "$bin\mysqladmin.exe" -uroot ping 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep 2
}
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) { Falla "MySQL no responde. Si ya estaba instalado, revisa la password de root. Log: $dataDir\*.err" }

function Sql($consulta) {
  & "$bin\mysql.exe" -uroot --default-character-set=utf8mb4 -e $consulta
  if ($LASTEXITCODE -ne 0) { Falla "Fallo la consulta: $consulta" }
}

if ($nueva -or $Reiniciar) {
  Paso 'Cargando db/schema.sql (tablas, catalogos y cuentas de prueba)'
  Sql "source $($schema -replace '\\', '/')"
}

Paso "Usuario zeroscam@$IpBack"
Sql "CREATE USER IF NOT EXISTS 'zeroscam'@'$IpBack' IDENTIFIED BY '$appPass'; ALTER USER 'zeroscam'@'$IpBack' IDENTIFIED BY '$appPass'; GRANT ALL PRIVILEGES ON ZeroScam.* TO 'zeroscam'@'$IpBack'; FLUSH PRIVILEGES;"
if ($nueva) { Sql "ALTER USER 'root'@'localhost' IDENTIFIED BY '$rootPass';" }
$env:MYSQL_PWD = $null

Paso 'Firewall: 3306 solo desde la PC del back, ping desde cualquiera'
Get-NetFirewallRule -DisplayName 'ZeroScam *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'ZeroScam MySQL' -Direction Inbound -Protocol TCP -LocalPort 3306 -RemoteAddress $IpBack -Action Allow | Out-Null
New-NetFirewallRule -DisplayName 'ZeroScam ping' -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -Action Allow | Out-Null

$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress -join ', '
Write-Host "`nListo. MySQL corre como servicio $servicio." -ForegroundColor Green
Write-Host "IP(s) de esta PC: $ips"
Write-Host 'En la PC del back corre 2-back.cmd y usa esta IP y la password de zeroscam.'
Read-Host "`nEnter para salir"

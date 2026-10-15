# ZeroScam - PC del BACK (Windows, sin Docker).
#
# Instala Node 22 portable en C:\ZeroScam\node, compila la API (este repo) y
# el panel (zeroscam-admin) y los deja corriendo como tareas de Windows que
# arrancan solas al prender la PC:
#   API   -> http://<IpBack>:3000   (app de iOS y panel)
#   Panel -> http://<IpBack>:3001
#
# Uso: doble clic en 2-back.cmd. Para actualizar despues de un git pull,
# vuelve a correrlo: recompila y reinicia todo.

param(
  [string]$IpBase = '192.168.10.10',
  [string]$IpBack = '192.168.20.10',
  [string]$Panel = '',
  [string]$NodeVersion = '22.23.3',
  [string]$Raiz = 'C:\ZeroScam',
  # Vuelve a pedir la IP de la base y la password aunque ya exista .env.
  [switch]$Reconfigurar
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Paso($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Falla($texto) { Write-Host "`nERROR: $texto" -ForegroundColor Red; Read-Host 'Enter para salir'; exit 1 }

$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) { Falla 'Abre este script como administrador (usa 2-back.cmd).' }

$api = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# El panel va junto a este repo: zeroscam-admin, o zeroscam-admin-main si se bajo en ZIP.
if (-not $Panel) {
  $Panel = (Get-ChildItem (Split-Path $api) -Directory | Where-Object { $_.Name -like 'zeroscam-admin*' } | Select-Object -First 1).FullName
}
if (-not $Panel -or -not (Test-Path (Join-Path $Panel 'package.json'))) {
  Falla "No encuentro el repo del panel. Ponlo junto a este, en $(Split-Path $api)\zeroscam-admin"
}

$nodeDir = Join-Path $Raiz 'node'
$logs = Join-Path $Raiz 'logs'
New-Item -ItemType Directory -Force $Raiz, $logs | Out-Null
# C:\ deja que cualquier usuario modifique carpetas nuevas; aqui hay .cmd que
# corren como SYSTEM. Solo SYSTEM (S-1-5-18) y Administradores (S-1-5-32-544).
icacls $Raiz /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /Q | Out-Null
if ($LASTEXITCODE -ne 0) { Falla "No se pudieron fijar los permisos de $Raiz" }

Write-Host 'ZeroScam - instalacion del back' -ForegroundColor Green
Write-Host "API:   $api"
Write-Host "Panel: $Panel"

Paso 'Deteniendo lo que ya estuviera corriendo'
foreach ($tarea in 'ZeroScam API', 'ZeroScam Panel') {
  if (Get-ScheduledTask $tarea -ErrorAction SilentlyContinue) { Stop-ScheduledTask $tarea }
}
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$nodeDir*" } | Stop-Process -Force
Start-Sleep 1

if (-not (Test-Path (Join-Path $nodeDir "node.exe")) -or ((& "$nodeDir\node.exe" -v) -ne "v$NodeVersion")) {
  Paso "Descargando Node $NodeVersion"
  $zip = Join-Path $env:TEMP "node-v$NodeVersion-win-x64.zip"
  curl.exe -L --fail -o $zip "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
  if ($LASTEXITCODE -ne 0) { Falla 'No se pudo descargar Node. Revisa el internet de esta PC.' }
  $tmp = Join-Path $Raiz 'node-tmp'
  Remove-Item $tmp, $nodeDir -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $zip $tmp
  Move-Item (Get-ChildItem $tmp)[0].FullName $nodeDir
  Remove-Item $tmp -Recurse -Force
}
$env:Path = "$nodeDir;$env:Path"
$npm = Join-Path $nodeDir 'npm.cmd'

$envFile = Join-Path $api '.env'
if ($Reconfigurar -or -not (Test-Path $envFile)) {
  Paso 'Conexion a la base de datos'
  $ip = Read-Host "IP de la PC de la base [$IpBase]"
  if ($ip) { $IpBase = $ip }
  do { $pass = Read-Host 'Password del usuario zeroscam (la que pusiste en la PC de la base)' } until ($pass -match '^[A-Za-z0-9]+$')
  $llave = Read-Host 'SAFE_BROWSING_API_KEY (opcional, Enter para omitir)'
  $contenido = @"
DATABASE_URL=mysql://zeroscam:$pass@${IpBase}:3306/ZeroScam
SAFE_BROWSING_API_KEY=$llave
SMTP_URL=
MAIL_FROM=
"@
  [IO.File]::WriteAllText($envFile, $contenido, (New-Object Text.UTF8Encoding $false))
} else {
  Write-Host "`nSe conserva $envFile (usa -Reconfigurar para cambiarlo)."
  $IpBase = ((Get-Content $envFile | Select-String '^DATABASE_URL=').Line -replace '.*@([^:/]+).*', '$1')
}

Paso "Probando conexion con MySQL en ${IpBase}:3306"
if (-not (Test-NetConnection $IpBase -Port 3306 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
  Write-Host 'AVISO: no hay conexion. Revisa que la PC de la base este prendida, su IP y su firewall.' -ForegroundColor Yellow
  Write-Host 'Se sigue instalando; la API reintentara cuando la base responda.' -ForegroundColor Yellow
}

function Npm($carpeta, [string[]]$argumentos) {
  Push-Location $carpeta
  & $npm @argumentos
  $codigo = $LASTEXITCODE
  Pop-Location
  if ($codigo -ne 0) { Falla "npm $($argumentos -join ' ') fallo en $carpeta" }
}

Paso 'API: instalando dependencias y compilando'
Npm $api 'ci', '--no-audit', '--no-fund'
Npm $api 'run', 'build'

Paso "Panel: compilando con la API en http://${IpBack}:3000"
# Next.js mete esta URL en el JavaScript al compilar: si cambia la IP hay que recompilar.
[IO.File]::WriteAllText((Join-Path $Panel '.env.production.local'), "NEXT_PUBLIC_API_URL=http://${IpBack}:3000`n", (New-Object Text.UTF8Encoding $false))
Npm $Panel 'ci', '--no-audit', '--no-fund'
Npm $Panel 'run', 'build'

Paso 'Registrando las tareas (arrancan solas con Windows y se reinician si se caen)'
function Tarea($nombre, $carpeta, $comando, $log) {
  $cmd = Join-Path $Raiz "$($nombre -replace ' ', '-').cmd"
  # Bucle: si node se cae, vuelve a arrancar a los 5 segundos.
  $script = @"
@echo off
cd /d "$carpeta"
set PATH=$nodeDir;%PATH%
:inicio
echo [%date% %time%] arrancando >> "$log"
$comando >> "$log" 2>&1
timeout /t 5 /nobreak > nul
goto inicio
"@
  [IO.File]::WriteAllText($cmd, $script, (New-Object Text.ASCIIEncoding))
  $accion = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`""
  $inicio = New-ScheduledTaskTrigger -AtStartup
  $quien = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask $nombre -Action $accion -Trigger $inicio -Principal $quien -Settings $ajustes -Force | Out-Null
  Start-ScheduledTask $nombre
}
Tarea 'ZeroScam API' $api 'node dist\main.js' (Join-Path $logs 'api.log')
Tarea 'ZeroScam Panel' $Panel 'node node_modules\next\dist\bin\next start -p 3001' (Join-Path $logs 'panel.log')

Paso 'Firewall: 3000 (API) y 3001 (panel) abiertos en la red'
Get-NetFirewallRule -DisplayName 'ZeroScam *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'ZeroScam API y panel' -Direction Inbound -Protocol TCP -LocalPort 3000, 3001 -Action Allow | Out-Null
New-NetFirewallRule -DisplayName 'ZeroScam ping' -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -Action Allow | Out-Null

Paso 'Esperando a que la API responda'
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep 2
  try { $ok = (Invoke-WebRequest 'http://localhost:3000/health' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {}
}

$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress -join ', '
if ($ok) { Write-Host "`nListo. La API responde." -ForegroundColor Green }
else { Write-Host "`nLa API no respondio todavia. Revisa $logs\api.log" -ForegroundColor Yellow }
if ($ips -notmatch [regex]::Escape($IpBack)) {
  Write-Host "AVISO: esta PC no tiene la IP $IpBack (tiene: $ips). El panel se compilo apuntando a $IpBack." -ForegroundColor Yellow
}
Write-Host @"

  Panel:    http://${IpBack}:3001
  API:      http://${IpBack}:3000   (Swagger en /docs)
  App iOS:  ZS_URL_BASE = http://${IpBack}:3000
  Logs:     $logs  (el codigo de 2 pasos sale en api.log)
"@
Read-Host "`nEnter para salir"

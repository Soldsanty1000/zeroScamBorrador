@echo off
REM Instala MySQL para ZeroScam. Pide permisos de administrador.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0base-de-datos.ps1\"'"

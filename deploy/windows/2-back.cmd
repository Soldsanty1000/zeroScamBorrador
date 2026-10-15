@echo off
REM Instala y arranca la API y el panel de ZeroScam. Pide permisos de administrador.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0back.ps1\"'"

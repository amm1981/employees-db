# Agente Windows en la PC de TI

El agente se instala en la PC de TI con acceso LAN/VPN a SQL Server. El VPS aloja Laravel y MySQL; no ejecuta las consultas al SQL privado. En TI sólo hacen falta Git y Node.js 24 LTS con npm, no PHP, Composer, Laravel ni MySQL.

## Clonar y preparar

Desde CMD de la PC de TI (si la carpeta no existe todavía):

```cmd
cd /d "%USERPROFILE%\Documents"
git clone https://github.com/amm1981/employees-db.git GET-Employes
cd GET-Employes
node --version
npm --version
npm ci
npm run build
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts\windows\Initialize-Agent.ps1
```

Usar Node 24.x. El inicializador crea `.env` si no existe, con URL del VPS, origen `ti-pc-01` y clave aleatoria de spool. Restringe los permisos a la cuenta Windows actual y conserva un `.env` existente sin reemplazar valores. No crea bases, fixtures ni tareas, y no consulta SQL Server. Mantener fija la carpeta del proyecto después de registrar la tarea.

Abrir `notepad .env` y completar localmente `SQL_HOST`, `SQL_PORT`, `SQL_USER`, `SQL_PASSWORD` y `API_INGEST_TOKEN`. El dominio ya queda en `API_BASE_URL=https://api-employeedb.ccruces.com`. `AGENT_ORIGIN=ti-pc-01` debe coincidir con el origen del token de servicio emitido en el VPS. No enviar secretos por el chat ni subir `.env`; no usar el token de login de `integracion.rrhh` para el agente. Conservar `SPOOL_KEY` mientras existan capturas pendientes cifradas.

## Token de ingesta del VPS

Un operador del VPS debe generar un secreto aleatorio de al menos 32 bytes y trasladarlo a TI mediante el canal de secretos de la organización. Registrar el mismo secreto en el VPS, desde `backend`, inyectándolo en la variable `SERVICE_TOKEN_NEW`:

```sh
php artisan service-token:issue casablanca-altas-bajas ti-pc-01 --scope=ingest --scope=publish --scope=cancel --days=90
unset SERVICE_TOKEN_NEW
```

El comando guarda sólo el hash e imprime el identificador, no el secreto. Poner el secreto original en `API_INGEST_TOKEN` de la PC de TI. El token expira; emitir y configurar otro antes de 90 días. La cuenta de consumo y su password no sustituyen este token.

## Diagnóstico y programación

```cmd
npm run validate
npm run preflight -- --integration casablanca-altas-bajas
```

`preflight` no abre conexiones. `ready=true` indica que las condiciones locales comprobables están completas; aún hay que comprobar conectividad, TLS y aceptación del receptor durante una sincronización real. `ready=false` enumera lo que falta y sale con código 2. El estado actual del código conserva contrato y adaptador pendientes; no cambiar `authorization`, `publicationEnabled` ni el manifiesto a aprobado para eludirlos.

Después de completar la configuración, registrar la tarea **en TI**:

```cmd
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts\windows\Install-SyncTask.ps1 -Integration casablanca-altas-bajas -Register
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts\windows\Test-SyncTask.ps1 -Integration casablanca-altas-bajas
```

La tarea `GET-Employes-casablanca-altas-bajas` se dispara cada 15 minutos. Comprueba configuración, recupera pendientes, consulta el SP autorizado y transmite/publica la captura completa. Si sigue bloqueada, sólo registra el diagnóstico; no sincroniza ni abre SQL. Los logs quedan en `.local/logs`. No se solapan ejecuciones.

Con esta modalidad, Windows debe permanecer encendido y la sesión del usuario iniciada. La pantalla puede estar bloqueada. Si TI necesita ejecutar con sesión cerrada, configurar una cuenta de servicio y su acceso a la red privada antes de usar otra modalidad de logon.

Para suspenderla desde PowerShell:

```powershell
Disable-ScheduledTask -TaskName GET-Employes-casablanca-altas-bajas
```

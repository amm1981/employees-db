# Agente Windows en la PC de TI

El agente se instala en la PC de TI con acceso LAN/VPN a SQL Server. El VPS aloja Laravel y MySQL; no ejecuta las consultas al SQL privado. En TI hacen falta Git, Node.js 24 LTS y Windows PowerShell 5.1/.NET Framework 4.8, no PHP, Composer, Laravel ni MySQL. CASABLANCA usa mssql para comprobar metadatos y un lector SqlDataReader para conservar números, fechas y texto CP1252 sin pasar por Number de JavaScript.

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

Primero actualizar el VPS y activar el contrato revisado, desde `backend`:

```sh
git pull --ff-only
php artisan integration:activate casablanca-altas-bajas
```

Este comando aprueba el esquema `casablanca-v1` y habilita ingesta/publicación de CASABLANCA en MySQL; es idempotente si versión y hash coinciden y rechaza conflictos. No activa Diamond, instala fixtures ni llama a SQL Server. Si el servidor mantiene procesos PHP persistentes, recargarlos después de actualizar el código.

Generar y registrar el secreto sin imprimirlo en el terminal:

```sh
umask 077
mkdir -p ../.local
export SERVICE_TOKEN_NEW="$(php -r 'echo bin2hex(random_bytes(32));')"
if php artisan service-token:issue casablanca-altas-bajas ti-pc-01 --scope=ingest --scope=publish --scope=cancel --days=90; then
    printf 'API_INGEST_TOKEN=%s\n' "$SERVICE_TOKEN_NEW" > ../.local/ti-agent-token.env
fi
unset SERVICE_TOKEN_NEW
```

El comando guarda sólo el hash e imprime el identificador, no el secreto. Descargar `../.local/ti-agent-token.env` mediante SFTP hacia la PC de TI y copiar su valor en `API_INGEST_TOKEN` del `.env` local. El archivo contiene una credencial: no pegarlo en el chat. El token expira; emitir y configurar otro antes de 90 días. La cuenta de consumo y su password no sustituyen este token.

## Activar el contrato en la PC de TI

Desde PowerShell, con las credenciales SQL ya guardadas en `.env`:

```powershell
Set-Location C:\Apps\GET-Employes
git pull --ff-only
npm ci
npm run build
npm run activate:casablanca
```

La activación prueba conversiones con datos ficticios, inspecciona nuevamente los metadatos y exige coincidencia exacta con las 37 columnas revisadas. No ejecuta el SP de trabajadores. Guarda aprobación y activación en `.local/approved` y `.local/activation`, ignorados por Git; no modifica el YAML ni las credenciales. La versión `casablanca-v1` tiene hash `fe45f5a9bc0f6b1216de750afc6fc67f91cba3c3e3cb9d2a6ecb5ea562af56f8`. El hash difiere del candidato por el nombre de versión; las columnas coinciden.

Las conexiones SQL siguen cifradas y admiten la confianza de certificado solicitada expresamente por el usuario en metadatos y extracción (`inspectionTrustServerCertificate` y `extractionTrustServerCertificate`). HTTPS al VPS mantiene la verificación del certificado. No se modifican SP ni tablas SQL ni se mezclan recordsets: un segundo recordset aborta la captura completa.

## Diagnóstico y programación

```cmd
npm run validate
npm run preflight -- --integration casablanca-altas-bajas
```

`preflight` no abre conexiones. `ready=true` indica que las condiciones locales comprobables están completas; aún hay que comprobar conectividad, TLS y aceptación del receptor durante una sincronización real. `ready=false` enumera lo que falta y sale con código 2. Después de activar y configurar el token, CASABLANCA debe tener cero restricciones del adaptador. Otras collations no verificadas continúan bloqueadas.

Antes de programar, hacer una extracción manual (contiene datos reales, almacenados cifrados en el spool):

```powershell
npm run sync -- --integration casablanca-altas-bajas --allow-sql
```

La salida contiene `runId`, cantidad de filas y lotes, sin valores de trabajadores. Si termina en `spool_sealed`, enviar esa misma captura y publicarla, sin volver a consultar SQL:

```powershell
npm run resume -- --run <runId_obtenido> --publish
```

Sólo después de `transfer_complete`, registrar la tarea. Si la extracción falla, el spool queda sin sellar y no se envía nada. Revisar el error antes de reintentar; no borrar capturas automáticamente. El resultado vacío continúa bloqueado por defecto.

Si una versión anterior devuelve `SQL_BRIDGE_FAILED`, actualizar y ejecutar la prueba offline del lector antes de repetir la extracción:

```powershell
git pull --ff-only
npm run build
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts\windows\Test-SqlExact.ps1
```

Se corrigió la doble lectura de texto/binarios en `SequentialAccess`: ya no se consulta longitud con `GetChars`/`GetBytes` para luego llamar a `GetValue` sobre la misma columna. El lector consume bloques una sola vez y comprueba los límites durante la lectura, incluso cuando el tamaño es desconocido. Las excepciones inesperadas indican etapa y categoría mediante códigos fijos, por ejemplo `SQL_BRIDGE_READ_CELL_0_INVALID_OPERATION`, sin mensajes del proveedor ni valores de filas. Se conservan las comprobaciones del esquema y los tipos exactos.

Antes de habilitar la tarea, revisar cada captura fallida y, con el agente detenido, mover sólo su directorio UUID sin sellar a `.local/quarantine`, fuera de `.local/spool`. Conservar sus archivos cifrados y la clave. `recover` seguirá bloqueado mientras haya capturas incompletas dentro del spool; una captura sin manifiesto no puede reanudarse ni publicarse. Ver [recuperación de fallos](runbook.md#fallos).

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

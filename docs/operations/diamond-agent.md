# Activar DIAMOND en la PC de TI y el VPS

El destino confirmado es `DIAMOND_BRIDGE_SAC`, mediante `[MarcacionesCB].[dbo].[spListarAltas_Bajas_DB_Prueba]`, sin parámetros. El usuario autorizó expresamente publicar `cod_empresa=NULL`. La política `preserve-null` exige NULL en todas las filas de producción y rechaza códigos añadidos. La tarea consultará cada 15 minutos. El procedimiento almacenado no se modifica.

## Detener la tarea anterior en TI

```powershell
Disable-ScheduledTask -TaskName 'GET-Employes-casablanca-altas-bajas'
Stop-ScheduledTask -TaskName 'GET-Employes-casablanca-altas-bajas'
```

Esto no borra capturas ni cambia el historial de CASABLANCA.

## Preparar el VPS

Desde la consola del servidor:

```sh
cd /var/www/employees-db/backend &&
git pull --ff-only &&
php artisan migrate --force &&
php artisan integration:activate diamond-bridge-altas-bajas &&
php artisan service-token:retarget ti-pc-01 casablanca-altas-bajas diamond-bridge-altas-bajas --token-file=../.local/ti-agent-token.env &&
php artisan consumer:assign integracion.rrhh --dataset=diamond-bridge-altas-bajas &&
php artisan integration:disable casablanca-altas-bajas &&
php artisan optimize:clear
```

La migración añade `company_code_policy` con valor predeterminado `required` para integraciones existentes. La activación explícita instala únicamente el contrato revisado de DIAMOND y su política `preserve-null`; crea su registro si no existe. Repetirla con la misma versión y hash es idempotente.

`service-token:retarget` identifica mediante hash el token guardado en el archivo protegido emitido antes para TI. Exige origen `ti-pc-01`, token vigente, no revocado y productivo, un único dataset anterior CASABLANCA o el destino DIAMOND y destino habilitado. Reasigna ese token exclusivamente a DIAMOND, conservando secreto, scopes y caducidad. No imprime secretos ni modifica el `.env` de TI. Si el archivo no existe, detenerse y emitir un token nuevo para DIAMOND; no seleccionar tokens por su posición en la tabla.

`consumer:assign` reemplaza los datasets de `integracion.rrhh` por DIAMOND, conserva la contraseña y revoca las sesiones existentes; el consumidor debe iniciar sesión de nuevo. La desactivación de CASABLANCA impide nuevas ingestas/publicaciones y conserva sus registros históricos. Si el despliegue usa procesos PHP persistentes, recargarlos con el mecanismo de ese servidor tras actualizar el código.

## Activar y probar desde TI

```powershell
Set-Location C:\Apps\GET-Employes
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Falló la actualización' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación' }
npm run activate:diamond
if ($LASTEXITCODE -ne 0) { throw 'Falló la activación' }
npm run preflight -- --integration diamond-bridge-altas-bajas
if ($LASTEXITCODE -ne 0) { throw 'Agente bloqueado' }
npm run sync -- --integration diamond-bridge-altas-bajas --allow-sql --send --publish
if ($LASTEXITCODE -ne 0) { throw 'Falló la sincronización de DIAMOND' }
```

La activación sólo prueba conversiones e inspecciona metadatos, sin ejecutar el SP de trabajadores. Guarda el esquema aprobado y su política en `.local`. El esquema `diamond-null-v1` tiene SHA-256 `4bea3f9338b98121611b0d29a20362461a84d49ca8c1c5897b0413eb92a59e91`.

El comando sync ejecuta el SP autorizado y publica su captura bajo `diamond-bridge-altas-bajas`. Si el envío falla después de `spool_sealed`, usar `npm run resume -- --run <UUID> --publish` para el mismo UUID. No repetir SQL para recuperar un lote ya sellado. Si falla la extracción, conservar y revisar su captura incompleta antes de programar. El resultado vacío sigue bloqueado por defecto.

## Registrar la tarea de DIAMOND

Después de `transfer_complete`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts\windows\Install-SyncTask.ps1 -Integration diamond-bridge-altas-bajas -Register -Update
if ($LASTEXITCODE -ne 0) { throw 'Falló el registro de la tarea' }
Start-ScheduledTask -TaskName 'GET-Employes-diamond-bridge-altas-bajas'
Start-Sleep -Seconds 10
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts\windows\Test-SyncTask.ps1 -Integration diamond-bridge-altas-bajas
npm run status
```

Comprobar `LastTaskResult=0`, `EveryMinutes=15`, `Ready=True` y una captura DIAMOND con `simulation=false` y checkpoint `published`. `-Update` sólo reemplaza una tarea de esta misma carpeta y cuenta; también permite crearla si no existe. La PC debe estar encendida, conectada a SQL y con la sesión de Windows iniciada. La pantalla puede bloquearse.

## Consumo

El login no cambia: `POST https://api-employeedb.ccruces.com/api/v1/auth/login`, body JSON `username=integracion.rrhh` y su contraseña existente. Con el nuevo `access_token`:

```http
GET /api/v1/employees?dataset=diamond-bridge-altas-bajas&page=1&pageSize=100
Authorization: Bearer <access_token>
```

La ventana sigue siendo las últimas 72 horas. `cod_empresa` permanece NULL en la respuesta; el dataset identifica a DIAMOND. La cuenta reasignada ya no permite consultar CASABLANCA.

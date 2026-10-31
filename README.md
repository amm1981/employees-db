# employees-db

GET-Employes: primera versión local del agente Windows y la API Laravel 12. Extrae **capturas de modificaciones observadas en una ventana móvil**; no representa el padrón completo. No elimina trabajadores ausentes ni deduplica filas legítimas.

Destino de esta instalación: **DIAMOND BRIDGE**, procedimiento `[MarcacionesCB].[dbo].[spListarAltas_Bajas_DB_Prueba]`. El usuario autorizó publicar conservando `cod_empresa=NULL`; no se rellena con códigos supuestos. La [guía de cambio a DIAMOND](docs/operations/diamond-agent.md) prepara el VPS, reasigna los permisos existentes y sustituye la tarea anterior de CASABLANCA.

Dominio configurado: **https://api-employeedb.ccruces.com**. La API de consumo ofrece `POST /api/v1/auth/login` con body `username`/`password`, `GET /api/v1/employees?dataset=diamond-bridge-altas-bajas` con token Bearer y `POST /api/v1/auth/logout`. Devuelve sólo modificaciones de las últimas 72 horas. Ver [cuentas, ejemplos y reglas de la API](docs/api/consumer-api.md), [OpenAPI](docs/api/openapi.yaml) y [activación del dominio en el VPS](docs/operations/domain.md).

El agente se prepara en la **PC de TI con Node.js 24**, sin instalar el backend allí. DIAMOND tiene repetición de **15 minutos** y necesita `npm run activate:diamond` antes de ejecutar. La CLI y el instalador de tareas usan DIAMOND por defecto; CASABLANCA requiere selección explícita.

La carpeta de desarrollo es `C:\Users\AlonsoMendoza\Documents\Dev\GET-Employes`; el agente de TI se instaló en `C:\Apps\GET-Employes`. DIAMOND tiene un contrato propio revisado de 37 columnas, adaptador exacto y política `preserve-null`. El repositorio no se autoactiva al clonarlo. Las capturas anteriores de CASABLANCA conservan su dataset e historial; no se convierten en datos de DIAMOND.

## Inicio local en Windows

Requisitos: Node.js 24 LTS, npm, Composer 2, PHP 8.3 con `pdo_sqlite`, `pdo_mysql`, `bcmath`, `mbstring`, `openssl`, `curl`, `xml`, `zip`. MySQL 8/InnoDB se prueba por separado. No hace falta SQL Server para probar fixtures.

```powershell
Set-Location C:\Users\AlonsoMendoza\Documents\Dev\GET-Employes
npm ci
Push-Location backend
composer install
Pop-Location
npm run validate
npm run build
npm test
npm run test:backend

# Prueba autónoma: DB SQLite nueva, servidor HTTP temporal en loopback y fixtures.
# PHP_BIN es opcional cuando php 8.3 ya está en PATH.
$env:PHP_BIN = 'C:\wamp64\bin\php\php8.3.28\php.exe'
npm run test:e2e
```

`composer.lock` fija Laravel 12 y dependencias compatibles con PHP 8.3. El generador original resolvió inicialmente paquetes para PHP 8.4; se corrigió con `config.platform.php=8.3.28`. El proyecto se prepara con los pasos anteriores y el script local siguiente; se retiraron los scripts del generador que ejecutaban migraciones automáticas e instalaban frontend.

## Simulación manual persistente

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\windows\Initialize-Local.ps1 -PhpPath $env:PHP_BIN -Fixtures
npm run sync -- --integration casablanca-altas-bajas --simulate
npm run sync -- --integration diamond-bridge-altas-bajas --simulate
npm run status

# En otra terminal, desde backend:
php artisan serve --host=127.0.0.1 --port=8000

# Desde la raíz, transmite y publica exclusivamente fixtures locales:
npm run sync -- --integration casablanca-altas-bajas --simulate --send --publish
npm run sync -- --integration diamond-bridge-altas-bajas --simulate --send --publish
npm run resume -- --run <UUID> --publish
npm run recover -- --integration casablanca-altas-bajas --simulate --publish
```

`Initialize-Local.ps1 -Fixtures` prepara `.env`, `backend/.env`, una SQLite bajo `.local`, claves aleatorias y tres tokens locales separados. No muestra secretos. Las ACL limitan acceso a la cuenta actual. Los tokens de fixtures duran 24 horas; volver a ejecutar el script renueva su vigencia. No ejecutar `-Fixtures` sobre una instalación configurada para producción.

Si Windows PowerShell indica que la ejecución de scripts está deshabilitada, usar `-ExecutionPolicy RemoteSigned` en esa invocación como arriba: permite los scripts locales para ese proceso, sin cambiar CurrentUser ni LocalMachine. Las políticas de grupo conservan su prioridad. Véase [la documentación de Microsoft](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1).

Desde **CMD**, con PHP 8.3 instalado en Wamp, usar la ruta explícita (la sintaxis `$env:PHP_BIN` sólo corresponde a PowerShell):

```cmd
cd /d C:\Users\AlonsoMendoza\Documents\Dev\GET-Employes
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts\windows\Initialize-Local.ps1 -PhpPath "C:\wamp64\bin\php\php8.3.28\php.exe" -Fixtures
cd backend
"C:\wamp64\bin\php\php8.3.28\php.exe" artisan serve --host=127.0.0.1 --port=8000
```

Mantener la terminal del servidor abierta mientras se ejecutan los comandos de envío desde otra terminal en la raíz.

Para consultar, obtener **localmente** `readToken` de `.local/fixture-tokens.json` y usarlo como Bearer en `GET http://127.0.0.1:8000/api/v1/datasets/casablanca-altas-bajas/records`. El token de ingesta carece de lectura. No copiar tokens a logs ni al repositorio.

La extracción real requiere activación local, `--allow-sql` y secretos externos. El repositorio clonado conserva los bloqueos hasta ejecutar `npm run activate:casablanca` en TI. La inspección directa ya se conectó correctamente usando la excepción de confianza de certificado solicitada por el usuario; su [alcance y evidencia](docs/operations/sql-inspection.md) están documentados. La primera extracción real y publicación se verifican desde TI.

## Inspección autorizada de metadatos

Después de configurar `SQL_HOST`, `SQL_PORT`, `SQL_USER` y `SQL_PASSWORD` en el `.env` local y obtener autorización para esa conexión:

```cmd
npm run inspect -- --integration casablanca-altas-bajas --allow-sql
```

La inspección es independiente de la aprobación de extracción. Mantener `authorization=pending` y `publicationEnabled=false`. Sólo se solicita análisis estático al SP de metadatos de SQL Server; no se ejecuta el SP de negocio ni se envían datos al VPS. Se guarda un candidato pendiente y un informe de limitaciones del adaptador en `contracts/pending/`. Consultar [el procedimiento completo](docs/architecture/contracts.md#inspección-y-aprobación-de-esquema).

Si se obtienen los metadatos desde la consulta preparada para SSMS, importarlos localmente sin conexión SQL:

```cmd
npm run inspect -- --integration casablanca-altas-bajas --from-file .local\casablanca.metadata.json
```

La guía [Inspección SQL](docs/operations/sql-inspection.md) explica la exportación desde SSMS y la conexión directa. La CA adicional está pendiente; el perfil permite conexiones SQL cifradas con la confianza de certificado solicitada por el usuario en inspección y extracción. HTTPS al VPS mantiene la verificación de su certificado.

## MySQL local y concurrencia

El verificador usa una instancia **dedicada** en `127.0.0.1:33079` y la base `get_employes_test`. No usa la instancia Wamp existente en el puerto normal ni credenciales del backend.

```powershell
.\scripts\windows\Start-TestMySql.ps1 -MySqlD C:\wamp64\bin\mysql\mysql8.4.7\bin\mysqld.exe
npm run test:mysql

# Detener exclusivamente el proceso de pruebas, tras verificar su datadir:
.\scripts\windows\Stop-TestMySql.ps1
```

El servidor aislado se inicializa sin contraseña administrativa para bootstrap local en loopback; el verificador crea un usuario con contraseña aleatoria limitado a la base de fixtures. Esta configuración es exclusivamente para pruebas. El script de pruebas refresca las tablas de **esa base dedicada**. El servidor se detuvo al terminar la implementación.

## Módulos

| Ruta | Responsabilidad |
|---|---|
| `agent/src/config.ts`, `config/` | Zod, YAML, registro cerrado de SP, secretos por referencia |
| `agent/src/sql.ts` | TLS, permisos previos, inspección controlada, stream con backpressure, finalización |
| `agent/src/contract.ts` | 37 columnas, tipos, serialización canónica y SHA-256 |
| `agent/src/spool.ts` | AES-256-GCM, ACL, lotes inmutables, sellado, checkpoints y locks |
| `agent/src/transport.ts` | HTTPS, reintentos acotados, acuses e idempotencia/reanudación |
| `agent/src/cli.ts` | validate, sync, inspect, status, resume, recover, unlock |
| `backend/app/Http/` | Ingesta, lectura, scopes, origen, publicación y rollback |
| `backend/app/Sync/` | Contrato compartido en PHP, auditoría y canonización |
| `backend/database/migrations/` | Staging cifrado, versiones y puntero activo transaccional |
| `contracts/schemas/` | Manifiestos reales pendientes, sin tipos inventados |
| `tests/fixtures/` | Esquema y filas **sintéticos**, no aprobados para origen real |
| `scripts/windows/` | Preparación local y automatización futura, sin registrar tareas |

## Documentación y límites

- [Arquitectura y modelo de datos](docs/architecture/design.md).
- [Contrato YAML, esquema y HTTP](docs/architecture/contracts.md).
- [CASABLANCA y DIAMOND BRIDGE: estado y evaluación de SP](docs/integrations/initial.md).
- [Revisión de las 37 columnas reales de CASABLANCA](docs/integrations/casablanca-schema-review.md).
- [Operación, recuperación, respaldo y rollback](docs/operations/runbook.md).
- [Seguridad, pendientes y futura instalación en Ubuntu](docs/operations/deployment.md).
- [Resultados de verificación y errores corregidos](docs/verification.md).
- [Inspección de esquema real y alternativa desde SSMS](docs/operations/sql-inspection.md).

El transporte conserva decimales y fechas como texto. CASABLANCA usa metadatos `mssql` y un lector Windows SqlDataReader con `SqlDecimal`, precisión temporal de 100 ns y validación CP1252 para las dos collations observadas. El driver directo tedious conserva sus bloqueos de tipos que puede redondear. La [activación en TI y VPS](docs/operations/ti-agent.md) verifica el contrato revisado antes de la primera extracción real; no se modifican procedimientos ni tablas SQL Server. Los tests usan trabajadores ficticios; la conectividad y primera extracción reales se comprueban desde TI.

FULL, SNAPSHOT_PERIOD, INCREMENTAL y BACKFILL se reservan en el diseño; el validador rechaza activarlos para estos SP. La ventana aproximada de tres días puede perder cambios durante una parada prolongada. Los SP originales se conservan intactos. El backend se despliega en el VPS y la tarea del agente se instala en la PC de TI; el equipo de desarrollo no mantiene una tarea registrada.

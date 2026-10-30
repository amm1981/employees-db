# API de trabajadores

URL de producción configurada: `https://api-employeedb.ccruces.com/api/v1`.

El flujo es **login con JSON → token Bearer → consulta**. Las cuentas de consumo sólo leen las empresas asignadas. Sus tokens no sirven para ingesta, publicación, rollback ni la lectura histórica administrativa `/datasets/.../records`. El agente conserva su token de servicio independiente. No hay registro público de usuarios ni credenciales predeterminadas.

## Preparación

En el backend instalado, después de hacer backup de su base:

```sh
php artisan migrate --force
php artisan workers:index
php artisan consumer:create integracion.rrhh --dataset=casablanca-altas-bajas
```

El último comando solicita una contraseña oculta de 16 a 72 bytes. En Windows puede usarse `C:\wamp64\bin\php\php8.3.28\php.exe` desde la carpeta `backend`. Para aprovisionamiento desatendido, inyectar `API_CONSUMER_PASSWORD` desde el gestor de secretos y añadir `--no-interaction`; no pasar contraseñas como argumentos ni guardarlas en Git. `--dataset` puede repetirse para asignar otras integraciones ya registradas. La cuenta se crea con password hasheado, nunca con privilegios del agente.

Para una cuenta exclusivamente de pruebas, usar `--simulation` en entorno local/testing con `SYNC_ALLOW_FIXTURES=true`. Esta cuenta sólo ve publicaciones sintéticas. Las cuentas productivas sólo ven publicaciones productivas. No se han creado cuentas ni contraseñas de producción en esta entrega.

Revocar inmediatamente una cuenta y todos sus tokens:

```sh
php artisan consumer:disable integracion.rrhh
```

## 1. Login

`POST /auth/login`, `Content-Type: application/json`:

```json
{
  "username": "integracion.rrhh",
  "password": "<contraseña creada por el administrador>"
}
```

El username usa minúsculas, números, punto, guion o guion bajo (máximo 80 caracteres). No se recortan ni normalizan contraseñas. Se exige body JSON; no se admiten credenciales por query string. Por ejemplo, guardar el body en un archivo local protegido `login.json` y ejecutar:

```sh
curl --request POST https://api-employeedb.ccruces.com/api/v1/auth/login --header "Content-Type: application/json" --data-binary @login.json
```

En PowerShell usar `curl.exe`. No subir `login.json` al repositorio. La respuesta es:

```json
{
  "access_token": "<token aleatorio de 64 caracteres hexadecimales>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "expires_at": "2026-10-30T18:00:00+00:00"
}
```

Sólo se almacena SHA-256 del token. Su duración predeterminada es de 60 minutos, configurable de 1 a 1440 mediante `CONSUMER_TOKEN_TTL_MINUTES`. Hay hasta diez sesiones activas por cuenta; nuevos logins revocan las más antiguas al superar ese número. El login limita cinco intentos/minuto por username y veinte/minuto por IP. El estado del límite requiere cache compartida persistente en producción (`CACHE_STORE=database` en la plantilla).

## 2. Consultar trabajadores

```sh
curl "https://api-employeedb.ccruces.com/api/v1/employees?dataset=casablanca-altas-bajas&page=1&pageSize=100" --header "Authorization: Bearer <access_token>" --header "Accept: application/json"
```

Parámetros permitidos:

| Parámetro | Descripción |
|---|---|
| `dataset` | Obligatorio; integración asignada a la cuenta |
| `page` | Desde 1; predeterminado 1 |
| `pageSize` | De 1 a 500; predeterminado 100 |
| `publicationId` | UUID opcional para fijar una publicación de la misma empresa y entorno entre páginas |

La respuesta contiene `datasetId`, `publicationId`, `sourceCompletedAt`, `mode=ROLLING_WINDOW_CAPTURE`, `exhaustive=false`, `window`, `page`, `pageSize`, `total` y `records`. Cada elemento tiene `ordinal` y `values`: un objeto con **las 37 columnas originales**, con mayúsculas originales y valores string/null. Se conservan decimales exactos, ceros iniciales, cadenas vacías y duplicados legítimos. `ordinal` identifica una fila dentro de su publicación, no un trabajador único.

El criterio temporal es explícito:

- Se toma la mayor fecha no nula entre `updpersonal`, `updagenda` y `updu` de cada fila.
- Se incluyen únicamente fechas en **[ahora UTC − 72 horas, ahora UTC]**, ambos extremos incluidos. Se excluyen fechas futuras y filas sin fecha de modificación.
- `SQL_SOURCE_TIMEZONE=America/Lima` interpreta datetime/datetime2 sin zona del SQL. Si el servidor utiliza otra zona, configurarla antes de ingerir. datetimeoffset respeta su offset explícito.
- El índice derivado almacena UTC con siete dígitos fraccionales; no redondea ni modifica el payload original cifrado. Cambiar la zona requiere ejecutar `workers:index` de nuevo.
- `window.from` y `window.to` exponen los límites usados. El consumidor no puede ampliarlos con fechas ni con un parámetro `days`.

Se consulta la última publicación completa por defecto. La consulta no ejecuta el procedimiento ni conecta el VPS a SQL Server. Una captura antigua puede devolver cero registros al salir sus fechas de la ventana. No se agregan publicaciones solapadas ni se deduplican registros. `total` cuenta sólo las filas que cumplen el filtro. El reloj avanza entre páginas incluso fijando `publicationId`; se recomienda consumirlas seguidas. `sourceCompletedAt` permite conocer la antigüedad de la captura.

La ventana es una regla de esta API. El filtro interno aproximado del SP permanece intacto; esta API no recupera filas que el SP no haya devuelto ni demuestra un padrón completo. Las restricciones pendientes de extracción real de CASABLANCA y publicación de Diamond siguen documentadas en [integraciones](../integrations/initial.md).

## 3. Cerrar sesión

```sh
curl --request POST https://api-employeedb.ccruces.com/api/v1/auth/logout --header "Authorization: Bearer <access_token>" --header "Accept: application/json"
```

Devuelve 204 y revoca inmediatamente ese token. Tras expirar se hace login de nuevo; no hay refresh token.

## Errores y transporte

Los errores tienen forma `{"error":{"code":"TOKEN_INVALID"}}`. Se exige HTTPS en producción y el host configurado en `APP_URL`; sólo se permite HTTP en loopback local/testing. No se confía automáticamente en cabeceras de un proxy. Respuestas de datos y login usan `Cache-Control: no-store, private`.

| Estado | Significado |
|---|---|
| 400 | HTTPS requerido o host incorrecto |
| 401 | Credenciales incorrectas, cuenta deshabilitada o token ausente/expirado/revocado |
| 403 | Empresa no asignada o fixtures deshabilitados |
| 404 | No existe una publicación de la empresa y entorno solicitado |
| 409 | Integridad incorrecta o `WORKER_INDEX_PENDING`: ejecutar `workers:index` sobre capturas anteriores |
| 415/422 | JSON/body/parámetros inválidos |
| 429 | Límite de peticiones; respetar `Retry-After` |

La consulta limita 120 peticiones/minuto por cuenta. No colocar username, password ni token en la URL. La auditoría guarda identificadores y cantidades, sin cuerpos ni valores de trabajadores.

Contrato importable: [OpenAPI](openapi.yaml). Despliegue del dominio: [guía del VPS](../operations/domain.md).

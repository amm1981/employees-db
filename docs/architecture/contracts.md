# Contratos de configuración, esquema y HTTP

## YAML

`config/integrations/*.yaml` se valida con Zod estricto en `agent/src/config.ts`. `config/integration.schema.json` permite asistencia del editor, pero las reglas adicionales de Zod son la autoridad (SP exacto, permisos y política de empresa). Se rechazan claves desconocidas, parámetros, IDs repetidos, SQL arbitrario y modalidades no autorizadas.

| Campo | Regla |
|---|---|
| id, procedure, database | Correspondencia exacta con allowlist compilada y MarcacionesCB |
| company, dataset | Identidad de empresa y destino; backend exige dataset=id |
| enabled, authorization | Aprobación de ejecución independiente de publicación |
| publicationEnabled | Requiere autorización approved; DIAMOND exige política preserve-null aprobada |
| companyCodePolicy | required por defecto; preserve-null aprobado expresamente para DIAMOND y ligado a su activación |
| mode | Sólo ROLLING_WINDOW_CAPTURE |
| schema | Manifiesto versionado aprobado en ruta local de confianza |
| emptyPolicy | block por defecto; allow-approved requiere también permiso receptor |
| limits | Máximo de filas/bytes y tamaño de lote; máximo global 10.000 lotes |
| schedule | Minutos, límite de duración y America/Lima |
| timeoutMs, retry | Timeout SQL y reintentos HTTP acotados |
| secrets | Nombres de variables de entorno; nunca valores |

`config/sql-profiles.yaml` exige `encrypt=true`, `trustServerCertificate=false` para extracción, timeouts y referencias de host/puerto/usuario/contraseña. La opción `inspectionTrustServerCertificate` (false por defecto) permite una excepción explícita sólo para metadatos. El usuario solicitó habilitarla en `private-lan`; el canal sigue cifrado, pero en esa inspección no se verifica el certificado del servidor. El usuario SQL sólo debe disponer de EXECUTE sobre los SP autorizados y los permisos de metadatos imprescindibles revisados por el DBA.

## Inspección y aprobación de esquema

CASABLANCA y DIAMOND tienen candidatos inspeccionados y contratos revisados independientes. DIAMOND usa `diamond-null-v1`, con `cod_empresa` nullable y política `preserve-null` autorizada por el usuario. Los manifiestos `.pending.json` no habilitan producción; la activación local compara metadatos reales y guarda el contrato aprobado en `.local`, mientras el VPS requiere su propia activación explícita. La lista de nombres por sí sola no permite inferir tipos, nullabilidad, tamaños ni collation.

Después de autorización expresa de acceso y preparación de secretos, el operador puede ejecutar una inspección independiente. **Mantener `authorization=pending` y `publicationEnabled=false`; no hace falta habilitar la extracción para inspeccionar.**

```powershell
npm run inspect -- --integration casablanca-altas-bajas --allow-sql
```

El comando sólo invoca `sys.sp_describe_first_result_set` con un `EXEC` construido de la allowlist para análisis estático; no ejecuta el SP de negocio ni modifica su definición. Véase [Microsoft: sp_describe_first_result_set](https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-describe-first-result-set-transact-sql). `--allow-sql` expresa autorización exclusivamente para esa invocación de inspección. Se rechazan `--simulate`, `--send` y `--publish` en este comando. No requiere clave de spool ni token del VPS.

Configurar localmente `SQL_HOST`, `SQL_PORT` (1433 salvo puerto explícitamente conocido), `SQL_USER` y `SQL_PASSWORD` en el `.env` de la raíz, usando la cuenta autorizada por el DBA. Con verificación TLS, `SQL_HOST` debe coincidir con el certificado y ser accesible por LAN/VPN. El perfil actual usa autenticación SQL, no autenticación integrada de Windows. No enviar secretos por chat ni pegarlos en comandos/logs; entrecomillar los valores en dotenv cuando contengan caracteres especiales. La excepción de inspección se documenta en la guía operativa; la extracción conserva la verificación.

La inspección guarda un candidato nuevo `contracts/pending/<integration>-<UUID>.json`, con ACL restringida, sin sobrescribir candidatos anteriores. Incluye fecha/ID de inspección, SP de origen, esquema exacto, SHA-256 y una lista de impedimentos del adaptador por columna. `adapterReview.compatible=true` sólo indica que no se detectaron las limitaciones conocidas del adaptador, **no** que el esquema esté aprobado. Todos los candidatos se guardan con `status=pending`; los manifiestos activos y permisos no cambian.

Existe también la alternativa offline `npm run inspect -- --integration casablanca-altas-bajas --from-file .local/casablanca.metadata.json`, que importa la exportación generada por `scripts/sql/Inspect-Casablanca-Metadata.sql` desde SSMS sin abrir conexiones. Usa las mismas validaciones que la inspección directa y exige coincidencia de integración/base/SP/método. El candidato conserva el hash del archivo y el método de origen. Véase la [guía de inspección y estado TLS](../operations/sql-inspection.md).

Si SQL Server no puede describir el resultado, faltan campos de metadatos o devuelve alias/tipos no soportados, se bloquea y requiere revisión DBA. No se adivinan tipos ni nullabilidad a partir de nombres o filas de muestra. Tampoco se ejecuta el SP real como fallback. Los errores de conexión se reportan mediante códigos sanitizados, sin contraseña ni mensajes detallados del driver.

Cada columna registra `name`, `sqlType`, `nullable`, `maxLength` **en bytes SQL**, `precision`, `scale`, `collation`. El manifiesto contiene `schema: {version, columns}` con exactamente 37 columnas ordenadas. Antes de usarlo: revisar metadatos y pérdida potencial del driver, asignar versión inmutable, registrar evidencia de aprobación y mover a un nuevo archivo versionado con `status=approved`. Configurar ese archivo en YAML y registrar la misma versión/hash en `integration_schemas` por un procedimiento de cambio controlado. **La carga/activación de esquemas productivos es una operación futura pendiente; no existe autoaprobación vía HTTP.**

El esquema sintético `tests/fixtures/schema.json` está aprobado únicamente en filas de backend con `simulation=true`. Nunca copiarlo para aprobar un esquema real.

## Representación sin pérdida

Filas como arrays posicionales de 37 elementos. Cada celda es texto o `null`, nunca un número JSON. El nombre y tipo provienen del esquema. `NULL` y `""` son distintos; no hay trim, normalización Unicode, conversiones de ceros iniciales ni deduplicación.

- Enteros/decimales: texto decimal, sin pasar por `Number`; la escala y precisión se validan.
- Fechas SQL sin zona: representación ISO sin agregar una zona ficticia. `date` usa `YYYY-MM-DD`; tiempos y timestamps conservan la precisión declarada por el adaptador aprobado.
- `datetimeoffset`: el contrato admite offset, pero el adaptador mssql actual lo bloquea por pérdida del offset original.
- Binarios: hexadecimal minúsculo, pares completos.
- `nvarchar`: máximo medido en UTF-16LE; `varchar` requiere verificar encoding de collation. El adaptador vivo sólo permite collation UTF-8 para varchar; no convierte silenciosamente páginas de códigos.

Canonización v1: JSON compacto UTF-8; claves estructurales ASCII ordenadas lexicográficamente de manera recursiva; arrays en orden; Unicode y `/` sin escapar; sin normalización de texto; hash SHA-256 hexadecimal minúsculo. Los números estructurales (ordinales, contadores) son enteros dentro del rango seguro. Se prueba igualdad de hashes entre Node y PHP.

`schemaHash = SHA256(canonical(schema))`; `batch.hash = SHA256(canonical(rows))`; `batch.bytes` cuenta bytes UTF-8 del array completo con separadores. El manifiesto enumera número de lote desde 0, primer ordinal desde 0, cantidad, bytes y hash; los rangos son contiguos, sin huecos ni superposición.

## API /api/v1

Todas las llamadas exigen `Authorization: Bearer <token>`. Ingesta exige además `X-Agent-Origin`, coincidente con origen del token y manifiesto. HTTP sin TLS sólo se admite en loopback local/testing. No se confía automáticamente en cabeceras de proxy.

| Método y ruta | Scope | Resultado |
|---|---|---|
| POST /sync/runs | ingest | Manifiesto completo; 201 nuevo, 200 reenvío idéntico, 409 conflicto |
| GET /sync/runs/{UUID} | ingest | Estado y contadores, sin filas |
| GET /sync/runs/{UUID}/batches | ingest | Números/hashes aceptados para recuperación |
| PUT /sync/runs/{UUID}/batches/{n} | ingest | `{hash, first, count, rows}`; acuse `{number, hash}` |
| POST /sync/runs/{UUID}/finalize | ingest | Verifica completitud/integridad/esquema, status finalized |
| POST /sync/runs/{UUID}/publish | publish | Versión y puntero activo, status published y publicationId |
| POST /sync/runs/{UUID}/cancel | cancel | Conserva evidencia; bloquea ejecución no publicada |
| GET /datasets | read | Sólo datasets permitidos, con exhaustive=false |
| GET /datasets/{id}/records | read | Filas, esquema, publicación y contexto de ventana |
| GET /datasets/{id}/publications | read | Historial paginado |
| POST /datasets/{id}/rollback | rollback | Cambio activo con control de concurrencia |

POST de estado usa `{}`. El formato exacto del manifiesto se encuentra en `Manifest` de `agent/src/spool.ts` y en el test E2E. El receptor no acepta otros modos ni esquemas autoenviados sin aprobación previa.

Filtros de records: `page` (desde 1), `pageSize` (1..500), `publicationId` (UUID de versión fijada), `ordinalFrom`. No se aceptan expresiones SQL ni filtros arbitrarios. Las filas de respuesta contienen `ordinal`, `runId`, `batchNumber`, `values`. Publications admite page/pageSize hasta 100.

Rollback usa `{publicationId, expectedActivePublicationId}`. Scope rollback es distinto de lectura e ingesta. Las versiones anteriores no se modifican.

Errores: `{"error":{"code":"..."}}`; 401 token ausente/expirado/revocado, 403 scope/origen/autorización, 404 recurso no disponible, 409 conflicto/completitud/integridad, 422 contrato/hash inválido, 429 límite, 500 error interno sanitizado. No se incluyen payloads, mensajes SQL, nombres ni documentos personales. Límite inicial: 120 peticiones/minuto por identidad/ruta de throttling de Laravel; definir rate limiter de identidad dedicado antes de tráfico productivo elevado.

## Tokens

Se almacena únicamente SHA-256 de tokens aleatorios de alta entropía (mínimo 40 caracteres), expiración, origen, scopes y datasets autorizados. `service-token:issue` lee un token nuevo de una variable de entorno sin imprimirlo. La emisión real no se ha ejecutado. Revocar actualizando `revoked_at`; rotar creando otro token y retirando el anterior después de cerrar recuperaciones. La identidad de origen es la del servicio autenticado; `X-Agent-Origin` no constituye atestación física de la máquina. mTLS es una mejora futura si se requiere identidad de dispositivo.

Los tokens de fixtures requieren simultáneamente local/testing, `SYNC_ALLOW_FIXTURES=true` y `simulation=true`. Se mantienen separados de tokens y esquemas productivos.

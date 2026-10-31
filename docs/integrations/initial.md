# Integraciones iniciales

## CASABLANCA

- ID/dataset: `casablanca-altas-bajas`; empresa de origen: `CASABLANCA`.
- Conexión a `MarcacionesCB`; procedimiento autorizado: `[MarcacionesCB].[dbo].[spListarAltas_Bajas_Csb]`.
- Producción existente, consumido por otros sistemas. No se ha leído ni cambiado su definición, ni ejecutado en esta implementación.
- Sin parámetros admitidos. El YAML está registrado pero `authorization=pending`, esquema pendiente y `publicationEnabled=false`; el backend no habilita ingesta productiva automáticamente.
- El esquema real no está aprobado. Los metadatos de las 37 columnas se importaron desde SSMS, respetando mayúsculas, orden, tipos, nullabilidad, longitudes y collation. La [revisión del candidato](casablanca-schema-review.md) identifica 34 restricciones del adaptador. El comportamiento de múltiples recordsets y la extracción real siguen sin verificarse.

Evaluación de seguridad **preliminar**, basada sólo en la descripción del usuario: el procedimiento accede a PII y a una base interna distinta de la base que aloja el SP. Debe verificarse con el DBA que sólo lee, no emite recordsets inesperados, no usa SQL dinámico peligroso, no depende de permisos administrativos ni de ownership chaining inseguro y no genera efectos secundarios. No se puede certificar inocuidad ni aislamiento transaccional sin revisar la definición y los permisos. No modificar el SP para instrumentarlo.

## DIAMOND BRIDGE

- ID/dataset: `diamond-bridge-altas-bajas`; origen: `DIAMOND_BRIDGE_SAC`.
- Conexión a `MarcacionesCB`; allowlist: `[MarcacionesCB].[dbo].[spListarAltas_Bajas_DB_Prueba]`.
- El SP de prueba existe y fue probado en SSMS por el usuario; este proyecto no lo ha ejecutado.
- `CAST(NULL AS VARCHAR(2)) AS cod_empresa` se conserva como null. No se rellenará con códigos supuestos.
- El usuario autorizó el 31 de octubre de 2026 publicar conservando `cod_empresa=NULL`. La política `preserve-null` exige NULL en todas las filas de producción, sin asignar códigos. `enabled=false`, `authorization=pending` y `publicationEnabled=false` en el YAML requieren [activación explícita en TI y VPS](../operations/diamond-agent.md).
- Los metadatos reales de 37 columnas están inspeccionados y el contrato `diamond-null-v1` está revisado. El adaptador .NET exacto admite los tipos. Los fixtures verifican el flujo productivo con NULL en bases de pruebas; no activan servidores reales.
- `[MarcacionesCB].[dbo].[spListarAltas_Bajas_DB]` **no está autorizado**: su adopción futura exige existencia verificada, revisión de esquema, evidencia de aprobación y un cambio de allowlist revisado. No hay alias automático.

La integración conserva el SP de prueba confirmado por el usuario. Un segundo recordset o una diferencia de esquema aborta la captura; los datos personales quedan cifrados en spool y backend. No se ha ejecutado el SP de trabajadores desde el equipo de desarrollo. No afirmar que el procedimiento definitivo existe ni sustituirlo sin aprobación.

## Ventana móvil y pérdida de cambios

La información disponible indica aproximadamente tres días de modificaciones en `tblRRHHPersonal` y `Agenda`, con filtros que usan `CAST(... AS DATE)` y `GETDATE()`. La definición exacta y sus operadores no se han recibido: no es posible garantizar el límite inferior, inclusividad, tratamiento de nulls ni timezone del SQL Server.

`CAST(timestamp AS DATE)` descarta la hora. Por ejemplo, si el predicado fuera `CAST(modificado AS DATE) >= CAST(DATEADD(DAY,-3,GETDATE()) AS DATE)`, a las 23:59 podría incluir casi cuatro días desde la medianoche de la fecha límite. Un predicado con `>` en lugar de `>=` o un CAST sólo de un lado cambia la cobertura. No se debe asumir una ventana exacta de 72 horas. `GETDATE()` usa el reloj/zona del SQL Server, no la zona de Windows ni la del VPS. Medianoche, correcciones de reloj y diferencias de zona pueden cambiar los bordes.

Riesgos concretos:

1. Una parada mayor que la cobertura efectiva puede dejar cambios definitivamente fuera de la siguiente ejecución. Reintentar no los recupera.
2. Un registro modificado varias veces dentro de la ventana suele mostrar sólo el estado observado; no es historial de todos sus cambios.
3. Un JOIN con Agenda u otras tablas puede repetir filas legítimamente; no deduplicar sin contrato.
4. Un filtro de modificaciones no garantiza informar borrados físicos ni todas las bajas de negocio.
5. Incluso extrayendo sin errores, la coherencia entre filas depende del aislamiento interno del SP. El spool asegura transmisión íntegra, no una instantánea transaccional del origen.

La frecuencia de una hora reduce el riesgo operativo, pero no demuestra exhaustividad. Como medida de operación deben monitorizarse retraso desde la última captura correcta, fallo de red, volumen anómalo y espacio libre; el umbral de alerta debe estar por debajo de la ventana mínima efectiva una vez confirmada. No se instaló un monitor ni una automatización recurrente en esta fase.

Propuesta futura, sujeta a aprobación: un **nuevo** SP de extracción con límites temporales explícitos o una fuente CDC/Change Tracking con cursor monotónico, desempate, retención y eventos de eliminación; más un SP de backfill para reparar huecos y, si se requiere padrón, una extracción FULL separada. Requiere revisar carga, aislamiento, permisos, compatibilidad y consumidores existentes con el DBA. Mantener intactos `spListarAltas_Bajas_Csb`, `spListarAltas_Bajas_Csb_v2` y `spListarAltas_Bajas_DB_Prueba`.

## Decisiones pendientes

Autorización de conectividad y metadatos; revisión de cada SP; manifiestos reales firmados por el responsable del cambio; adaptador sin redondeos; código aprobado de Diamond; autorización de SP definitivo; volumen/frecuencia real; semántica de vacío; definición de disponibilidad y alertas; retención de PII y backups; consumidores y scopes; evidencia de recuperación si se excede la ventana. Ninguno se considera aprobado por existir un fixture exitoso.

# Inspección del esquema de CASABLANCA

## Actualización al 31 de octubre de 2026

La PC de TI confirmó nuevamente el mismo hash y las 37 columnas. Se implementó el adaptador exacto Windows y el contrato `casablanca-v1`; seguir [la activación en TI/VPS](ti-agent.md). `npm run inspect` seguirá generando candidatos pendientes, sin aprobarlos automáticamente. El adaptador dotnet ya soporta los 34 tipos/codificaciones que el driver anterior bloqueaba.

Por la instrucción expresa del usuario de confiar en el certificado SQL, el perfil tiene `inspectionTrustServerCertificate=true` y `extractionTrustServerCertificate=true`, siempre con cifrado. Ambas opciones predeterminan false si se omiten. La validación HTTPS permanece activa. Las notas del 29 de octubre que siguen describen el alcance histórico inicial, que era sólo inspección.

## Estado al 29 de octubre de 2026

El usuario autorizó avanzar con la inspección de CASABLANCA y configuró las credenciales SQL en el `.env` privado. No se imprimieron ni se versionaron sus valores.

Inicialmente, la conexión se detuvo por una cadena TLS no confiable (`SQL_TLS_CA_UNTRUSTED`), incluso usando las CA de Windows. El usuario obtuvo e importó los metadatos desde SSMS y posteriormente solicitó explícitamente confiar en el certificado para omitir esa comprobación.

Se habilitó `inspectionTrustServerCertificate=true` exclusivamente para el modo de inspección del perfil `private-lan`, conservando `encrypt=true`. La inspección directa autenticó correctamente y devolvió las 37 columnas. Su hash coincide exactamente con el obtenido por SSMS: `e30fd773f9ccc5d0db7c60da4b0adfe19ff7db526e587ec79df8b390a8a21ecd`.

La evidencia directa está en `contracts/pending/casablanca-altas-bajas-dde96e4c-4fc7-4a87-bcba-c41f8af2018a.json`, con `source.certificateValidation=not-verified-user-authorized`. La conexión se cifra, pero en este modo no se comprueba la identidad del servidor mediante su certificado. No se instalaron CA ni se modificó el almacén de Windows o la validación HTTPS del VPS.

El candidato de esa importación se conserva en `contracts/schemas/casablanca.candidate-1.json`, con hash `e30fd773f9ccc5d0db7c60da4b0adfe19ff7db526e587ec79df8b390a8a21ecd`. Los 34 bloqueos se agrupan en 27 campos de texto, 6 datetime y 1 numeric(18,0); véase la [revisión del esquema](../integrations/casablanca-schema-review.md).

La incorporación de una CA adicional queda pendiente. La extracción conserva `trustServerCertificate=false`, `authorization=pending` y publicación deshabilitada; Diamond mantiene todos sus bloqueos. No se han recibido filas de trabajadores ni se ha ejecutado el SP de negocio desde el agente.

La excepción está en `config/sql-profiles.yaml`. Para volver a validar el certificado en la inspección, establecer `inspectionTrustServerCertificate: false`. Su valor por defecto es false cuando la opción no está presente. Los tests comprueban que la excepción no se aplica a la extracción.

## Alternativa: exportar desde SSMS

Esta vía aprovecha una sesión de SSMS que el operador ya tenga autorizada. El operador gestiona la conexión y su configuración de confianza. El agente únicamente importa un archivo local; no abre ninguna conexión SQL en ese modo.

1. Abrir en SSMS `scripts/sql/Inspect-Casablanca-Metadata.sql` y revisar la consulta.
2. Ejecutarla en la sesión autorizada del servidor que aloja `MarcacionesCB`. Requiere SQL Server 2016 o posterior por su formato JSON. La consulta llama a `sys.dm_exec_describe_first_result_set_for_object`; no ejecuta ni altera el SP de negocio. Si la versión no soporta JSON o la cuenta no puede describir el objeto, conservar el error para revisar una alternativa; no sustituirlo por ejecución del SP ni inferir tipos.
3. En resultados a cuadrícula, copiar **el valor de la única celda JSON**, sin encabezados, y guardarlo como `.local/casablanca.metadata.json` en el repositorio. Usar UTF-8; el importador también reconoce UTF-16LE con BOM. Verificar que SSMS no recorte el contenido: aumentar el límite de caracteres de columnas no XML si fuera necesario (por ejemplo, a 65535).
4. Desde la raíz, importar:

```cmd
npm run inspect -- --integration casablanca-altas-bajas --from-file .local\casablanca.metadata.json
```

No agregar `--allow-sql`, `--simulate`, `--send` ni `--publish` a la importación. No requiere credenciales SQL, clave de spool ni token del VPS para procesar el archivo.

El export contiene integración, base, SP y método de inspección, además de columnas con ordinal, nombre, tipo SQL, nullabilidad, longitud, precisión, escala y collation. El importador rechaza origen diferente, archivos truncados, errores de metadatos, alias no soportados, columnas faltantes y archivos de más de 256 KiB. Conserva SHA-256 del archivo importado y del esquema normalizado.

Se crea un archivo nuevo y restringido `contracts/pending/casablanca-altas-bajas-<UUID>.json`. Todos los candidatos tienen `status=pending`; no reemplazan el esquema activo ni aprueban la extracción. Incluyen un informe por columna sobre limitaciones conocidas del driver. `compatible=true` no constituye aprobación.

## Reanudar una inspección directa en el futuro

Con la cadena pública de CA verificada por el DBA y el nombre del servidor que cubre el certificado, se podrá configurar confianza adicional. No basta con quitar un requisito de archivo: una CA ausente sigue produciendo un error TLS.

Node permite ampliar sus CA con `NODE_EXTRA_CA_CERTS`, establecido **antes de iniciar Node**, no mediante dotenv después del arranque. En CMD, cuando exista un archivo PEM aprobado:

```cmd
set "NODE_EXTRA_CA_CERTS=C:\ruta\aprobada\ca-empresa.pem"
npm run inspect -- --integration casablanca-altas-bajas --allow-sql
set "NODE_EXTRA_CA_CERTS="
```

El ejemplo no se ha ejecutado porque aún no hay un certificado aportado. También debe verificarse la coincidencia del nombre DNS/IP con el certificado. No cambiar `trustServerCertificate` ni desactivar `NODE_TLS_REJECT_UNAUTHORIZED` para ocultar el error.

Referencias: [Microsoft: análisis del primer resultado para un objeto](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-describe-first-result-set-for-object-transact-sql), [Node: CA del sistema y adicionales](https://nodejs.org/api/cli.html#node_extra_ca_certsfile).

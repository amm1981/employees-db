# Verificación de primera fase

## DIAMOND con NULL autorizado y cambio de destino

El 31 de octubre de 2026 el usuario confirmó que el destino es DIAMOND BRIDGE y autorizó publicar los resultados de `spListarAltas_Bajas_DB_Prueba` conservando `cod_empresa=NULL`. La inspección real de metadatos devolvió 37 columnas; sólo cambia la nullabilidad de `cod_empresa` respecto a CASABLANCA. No se ejecutó el SP de trabajadores desde el equipo de desarrollo.

- Contrato independiente `diamond-null-v1`, SHA-256 `4bea3f9338b98121611b0d29a20362461a84d49ca8c1c5897b0413eb92a59e91`.
- 70 pruebas del agente aprobadas y TypeScript compilado: activación exige aprobación ligada al esquema y a la política NULL; un código añadido impide sellar.
- 41 pruebas del backend y 391 assertions aprobadas tanto en SQLite como en MySQL 8.4.7/InnoDB dedicado. La publicación productiva con NULL funciona, los códigos añadidos se rechazan y CASABLANCA conserva su política. Reasignar datasets conserva la contraseña y revoca sesiones; cambiar el destino de un token conserva su hash, scopes y caducidad y rechaza origen incorrecto, token revocado y permisos ambiguos.
- E2E HTTP aprobado con datos ficticios: formateador .NET → contrato productivo DIAMOND → captura cifrada → receptor Laravel → publicación → login → API de trabajadores. `cod_empresa` sigue NULL y se conservan duplicados, CP1252 y numeric(18,0).
- CLI e instalador de tareas usan DIAMOND por defecto. No se registró ninguna tarea en el equipo de desarrollo. La instalación real del cambio en TI/VPS y la primera publicación de trabajadores DIAMOND quedan por verificar allí.

## Corrección de lectura secuencial: 31 de octubre de 2026

El primer intento real en TI terminó con `SQL_BRIDGE_FAILED` y captura sin sellar. La revisión detectó que la comprobación de longitud con `GetChars` seguida de `GetValue` releía una columna ya consumida en modo `SequentialAccess`. La [implementación de referencia de SqlDataReader](https://github.com/microsoft/referencesource/blob/main/System.Data/System/Data/SqlClient/SqlDataReader.cs) confirma esa restricción. Se reemplazó por lectura incremental de texto/binarios con offsets crecientes y límites durante la lectura.

La regresión offline simula acceso secuencial estricto, reproduce el rechazo del patrón anterior y prueba texto CP1252, Unicode dividido entre bloques, espacios finales, cadenas/binarios vacíos, nulos, cero, lecturas cortas, valores grandes y límites exactos/excedidos. Comprueba que las excepciones se reduzcan a categorías fijas sin exponer mensajes privados. No abre SQL. Windows PowerShell 5.1, compilación TypeScript, 67 pruebas del agente y E2E HTTP con PHP 8.3.28 aprobados. La conexión real corregida debe confirmarse en TI antes de programar la tarea.

## Lectura exacta y activación: 31 de octubre de 2026

- TypeScript compilado y 66 pruebas del agente aprobadas, incluyendo truncamiento del protocolo, falta de confirmación final, múltiples recordsets, CP1252 y activación local ligada al hash del contrato.
- Lector .NET probado bajo Windows PowerShell 5.1 sin consultar SQL: numeric de 18 y 38 dígitos, cultura fr-FR, los 300 ticks de datetime por segundo, datetime2/time de siete decimales, offsets y las 256 posiciones CP1252.
- Backend: 37 pruebas y 341 assertions aprobadas tanto en SQLite como en MySQL 8.4.7/InnoDB dedicado. Incluyen activación idempotente, conflictos de versión y recepción/publicación con el contrato real y valores ficticios.
- E2E aprobado: formateador .NET → protocolo del agente → spool → Laravel HTTP → contrato CASABLANCA v1 → API de trabajadores autenticada. Conserva numeric(18,0), CP1252, ceros iniciales y duplicados. Todos los trabajadores son ficticios; no se ha ejecutado el SP de negocio en el equipo de desarrollo.
- La activación de TI vuelve a inspeccionar metadatos, compara con el contrato revisado y guarda los archivos aprobados sólo en `.local`, sin modificar YAML ni secretos. El VPS tiene un comando explícito e independiente para habilitar el contrato.

## Agente de TI: 31 de octubre de 2026

CASABLANCA configura repetición de 15 minutos. Se añadió `preflight` sin acceso a SQL/HTTP y preparación del agente para Windows sin dependencias PHP/MySQL. Compilación y 55 pruebas del agente aprobadas. El inicializador se probó con Windows PowerShell 5.1 en una carpeta temporal: crea un `.env` protegido con clave de 32 bytes y preserva el archivo en una segunda ejecución. Los scripts PowerShell pasan el parser.

Se verificó una tarea Windows con repetición `PT15M`, `IgnoreNew` y salida `2` por configuración pendiente; no se consultó el SP ni se enviaron datos. Esa tarea fue retirada al confirmar que el destino es la PC de TI. No queda registrada en el equipo de desarrollo. La instalación en TI y su conectividad se verifican allí; las restricciones del adaptador real permanecen pendientes.

## Ampliación del 30 de octubre de 2026

Se configuró `api-employeedb.ccruces.com` en las plantillas y se añadió login JSON, tokens de consumo revocables, consulta filtrada a las últimas 72 horas y comandos de aprovisionamiento/indexación. No se cambiaron DNS ni servidores remotos.

- Backend: 34 pruebas, 323 assertions, aprobadas con PHP 8.3.28 tanto en SQLite como en MySQL 8.4.7/InnoDB dedicado. Incluyen 12 pruebas de la API de consumo: autenticación, aislamiento de tokens/empresas/entornos, revocación, HTTPS/host, límites, paginación, indexación y bordes temporales de 100 ns.
- E2E HTTP aprobado: login con JSON, emisión de token, consulta con duplicados y exclusión de filas de hace cuatro días, cierre de sesión y rechazo del token revocado; también se mantienen las comprobaciones anteriores de sincronización, rollback y recuperación.
- Agente: validación y compilación aprobadas; 51 pruebas aprobadas.
- OpenAPI: YAML leído y referencias internas verificadas, con tres rutas y 37 campos. La plantilla Nginx debe validarse con `nginx -t` en el VPS después de instalar certificados; Nginx no está disponible en esta estación Windows.

Los valores y credenciales usados para verificar el flujo son sintéticos. Las restricciones pendientes del adaptador SQL real no se aprobaron ni se desactivaron al añadir esta API.

## Entrega inicial

Fecha de entrega: 26 de octubre de 2026 (America/Lima). Directorio inicialmente vacío; Git inicializado sin commits ni envío a remotos. No había archivos de proyecto que preservar.

## Entorno utilizado

Windows, Node.js 24.22.0, npm 11.19.1, PHP 8.3.28 para la suite principal y E2E, Composer 2.10.3, Laravel 12.70.1 y MySQL 8.4.7/InnoDB. PHP 8.4 era inicialmente el predeterminado en PATH; se localizó PHP 8.3 en Wamp y se usó explícitamente con PHP_BIN. También se ejecutó el comando npm de backend con el PHP predeterminado, sin fallos.

Docker y SQL Server CLI no aparecían en PATH; no se necesitaron. MySQL no estaba en PATH, pero se localizó su binario en Wamp. Se creó una instancia nueva con datadir `.local/mysql-test-data`, puerto 33079 y usuario de aplicación limitado a `get_employes_test`. No se utilizó ni cambió la instancia Wamp existente. El proceso aislado se cerró al terminar. No hay servicios ni tareas nuevos registrados.

## Comprobaciones ejecutadas

| Comando / prueba | Resultado |
|---|---|
| npm ci --ignore-scripts | Lockfile reproducible instalado; se usaron binarios empaquetados disponibles |
| npm run validate | Los dos YAML y perfil SQL válidos; esquemas reales reportados pendientes |
| npm run build | TypeScript estricto compila, ES2024 sobre Node 24 |
| npm test | 23 pruebas Vitest aprobadas |
| npm run test:backend | 22 pruebas PHPUnit aprobadas, 153 assertions, SQLite en memoria |
| npm run test:e2e | Agente → Laravel HTTP loopback → SQLite → API de consulta; aprobado |
| npm run test:mysql | Misma suite de 22 pruebas/153 assertions en MySQL 8.4.7, más concurrencia con procesos PHP independientes; aprobado |
| composer check-platform-reqs con PHP 8.3 | Requisitos satisfechos |
| npm audit / composer audit | Cero avisos conocidos en el momento de la comprobación |
| PowerShell Parser | Todos los scripts .ps1 sin errores sintácticos |
| Initialize-Local.ps1 -Fixtures | .env y claves locales protegidas, DB y tokens ficticios preparados |
| sync --simulate de ambas empresas, status | Spools sellados con tres filas por integración y Diamond null |
| Test-SyncTask.ps1 | CASABLANCA no registrada; no se llamó al registro de ninguna tarea |
| git check-ignore | .env, backend/.env, .local, vendor, node_modules y dist excluidos |

## Pruebas negativas y garantías observadas

Agente: rechazo de SQL no autorizado, parámetros ajenos, base cambiada, modalidades no permitidas, publicación de Diamond y conexión sin aprobación. Columnas en orden, precisión decimal, tipos/nulos/tamaños, fechas válidas, Unicode, ceros iniciales, cadenas vacías y duplicados. Límites de filas/bytes; vacío bloqueado por defecto y permiso de vacío explícito. Cifrado local, modificación del ciphertext detectada, no sobrescritura y UUID sin traversal. Extracción parcial sin sellado. Lock concurrente y liberación tras error. HTTPS obligatorio, reintentos acotados, 409 no reintentado y acuse perdido recuperado desde el mismo spool.

Backend: autenticación, scopes independientes, origen, dataset, expiración y revocación; fixture mode bloqueado al deshabilitarlo. Reenvío idempotente de ejecución y lote, conflicto 409 ante contenido cambiado, hashes/esquema/ordinales inválidos, vacío sin aprobación, lotes incompletos y publicación sin finalizar. Filas incorrectas revierten todo el lote. Integridad del staging y revocación del esquema comprobadas. Publicación antigua bloqueada, cancelación, páginas fijadas a versión, filtros desconocidos rechazados, historial intacto, rollback CAS y permiso separado. Fallo de almacenamiento simulado durante el cambio de puntero revierte la nueva versión y conserva la anterior. Corrupción histórica impide rollback. Diamond exige código aprobado coincidente antes de completar una captura no simulada (usando sólo datos ficticios en la base de test).

Concurrencia real: dos procesos PHP distintos envían el mismo lote simultáneamente y ambos reciben el mismo acuse sin duplicar registros. Dos procesos publican la misma ejecución simultáneamente y reciben el mismo ID de publicación. Se ejecutó contra InnoDB con los bloqueos de la implementación.

E2E: hashes canónicos Node/PHP coinciden, incluidas cadenas Unicode, decimales de 38 dígitos y timestamps de siete decimales sintéticos. La red se interrumpe deliberadamente después de que Laravel acepte un lote y antes de que el agente reciba el acuse; resume transfiere sólo pendientes del UUID original. Se verifica lectura exacta, dos versiones y rollback, integración Diamond separada, null intacto y rechazo de acceso anónimo. También se prueban sync/resume/status/recover de la CLI compilada.

## Errores encontrados y corregidos

- Composer resolvió inicialmente dependencias Symfony para PHP 8.4. Se fijó plataforma 8.3.28, restricción PHP ^8.3 y se regeneró el lock con versiones compatibles.
- La instalación inicial de npm reportó vulnerabilidades transitivas de Vitest y Azure MSAL. Se actualizó Vitest y se fijó el MSAL corregido mediante override; se verificó el árbol después de npm ci.
- El primer test de cifrado falló porque no había APP_KEY de pruebas. Se añadió una clave exclusivamente sintética en la configuración PHPUnit y claves aleatorias para E2E.
- El servidor PHP E2E arrancó inicialmente desde el directorio incorrecto. Se ajustó a backend/public; los tests usan sólo loopback y lo cierran al terminar.
- El script npm de backend no funcionaba desde la raíz con artisan. Se corrigió con un lanzador que define cwd=backend y respeta PHP_BIN.
- Se ajustó el target TypeScript a ES2024 para validar Unicode mediante isWellFormed, compatible con Node 24.
- Se añadió un bootstrap de tests que fuerza SQLite en memoria por defecto y sólo admite MySQL con opt-in hacia la base/puerto dedicados, evitando que RefreshDatabase herede configuración de despliegue.
- La revisión amplió la verificación de rollback y aprobación vigente del esquema; las pruebas negativas correspondientes pasan.

## No verificado y bloqueos reales

No hubo conexión a SQL Server, ejecución real de SP, lectura de datos personales, instalación de certificados productivos, introducción de credenciales reales, migración productiva, despliegue, conexión al VPS ni publicación en Internet. Los SP y sus metadatos reales siguen pendientes. La compatibilidad del driver con esos SP **no está demostrada**.

El contrato y los fixtures conservan decimales/timestamps exactos; la extracción real bloquea tipos que mssql convierte con pérdida. Resolver ese adaptador depende de los tipos reales y requiere pruebas adicionales. También quedan pendientes la evaluación de permisos/efectos internos del SP, código aprobado de Diamond, autorización de esquemas, pruebas de volumen, corte eléctrico, recuperación de desastre, tareas desatendidas y Ubuntu/PHP-FPM/Nginx. No se declara terminada la integración productiva.

## Actualización: 29 de octubre de 2026

Se separó la inspección de metadatos de la aprobación de extracción, con autorización explícita por invocación, cierre de conexiones y candidatos inmutables pendientes. Los permisos y manifiestos de extracción no se modificaron. Se añadieron validación estricta de metadatos, informe de limitaciones por columna y códigos de conexión sanitizados (TLS, DNS, red y login).

Con autorización del usuario y secretos aportados localmente se intentó la inspección de CASABLANCA. La cadena TLS no es de confianza (`SQL_TLS_CA_UNTRUSTED`), incluso usando las CA del sistema Windows. No se completó el login, no se ejecutó el SP de negocio y no se obtuvo un esquema real. La incorporación de CA quedó pendiente por indicación del usuario.

Se preparó `scripts/sql/Inspect-Casablanca-Metadata.sql` para exportación manual desde SSMS (SQL Server 2016+) y un importador offline. El SQL no se ha ejecutado contra el servidor; su disponibilidad depende de la versión/permisos reales. El importador se verificó con metadatos sintéticos en UTF-8 y UTF-16LE, hashes exactos, rechazo de fuentes distintas, alias, errores, truncamientos y exceso de tamaño. No se inventaron metadatos de producción.

Resultados nuevos: `npm run build`, `npm test` (**49 pruebas aprobadas**) y `npm run test:e2e` (**PASS**, PHP 8.3.28). La prueba E2E se ejecutó únicamente con fixtures, sin usar las credenciales SQL. El backend no cambió en esta actualización. El [estado de inspección y pasos operativos](operations/sql-inspection.md) describe cómo continuar.

### Metadatos reales importados posteriormente

El usuario ejecutó la consulta de metadatos en SSMS e importó la exportación con éxito. Se revisó el candidato `8f6a68c4-f71e-436d-99e2-ea1c45a4a45b`, verificando las 37 columnas y la igualdad de SHA-256 entre esquema importado y copia versionada. El hash del esquema es `e30fd773f9ccc5d0db7c60da4b0adfe19ff7db526e587ec79df8b390a8a21ecd`.

Los 34 bloqueos no son errores observados en filas: se agrupan en 27 columnas varchar/char con codificación heredada, 6 datetime y numeric(18,0) en id_planilla. Se conservó el esquema sin cambiar sus tipos ni su hash en `contracts/schemas/casablanca.candidate-1.json`. El manifiesto activo sigue sin esquema aprobado. Esta revisión no ejecutó SP de negocio, no cambió permisos ni habilitó publicación. Detalle en [revisión de CASABLANCA](integrations/casablanca-schema-review.md).

### Conexión directa SQL con excepción de certificado autorizada

Por petición explícita del usuario se incorporó `inspectionTrustServerCertificate=true`, limitada al modo de inspección. La conexión mantiene `encrypt=true`; la extracción conserva verificación de certificado y aprobación pendiente. No se modificó TLS global ni HTTPS del VPS.

`npm run inspect -- --integration casablanca-altas-bajas --allow-sql` se ejecutó correctamente contra SQL Server. Se recibieron 37 columnas mediante `sys.sp_describe_first_result_set`, con el mismo hash que el archivo SSMS (`e30fd773f9ccc5d0db7c60da4b0adfe19ff7db526e587ec79df8b390a8a21ecd`). El nuevo candidato registra `certificateValidation=not-verified-user-authorized`; no está aprobado y mantiene los 34 bloqueos de adaptación.

Verificación de esta modificación: build correcto y **51 pruebas del agente aprobadas**, incluyendo la separación de la política de certificado entre inspección y extracción. No se ejecutó el SP de negocio ni se recibieron registros personales.

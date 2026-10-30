# Operación y recuperación

## Configuración y secretos

El agente carga `.env` de la raíz aunque se invoque desde `agent/`. `dotenv` no reemplaza secretos ya inyectados en el proceso. Preferir cuenta de servicio con secretos provistos desde Windows Credential Manager/DPAPI por el operador; esta versión admite inyección por variables y `.env` local con ACL restringida, no incorpora todavía un proveedor directo de Credential Manager. Nunca incluir secretos productivos en archivos versionados.

El spool usa AES-256-GCM por archivo con nonce aleatorio de 96 bits y tag autenticado. `SPOOL_KEY` debe ser base64 de 32 bytes aleatorios. Su almacenamiento y respaldo son independientes del spool: guardar la clave sin control junto con los datos elimina gran parte de la protección. BitLocker aporta una capa adicional. En Windows, icacls restringe los directorios del spool; Unix usa modos 0700/0600 (y una umask apropiada). La ACL no protege contra administradores del equipo.

`APP_KEY` protege payloads del backend mediante el cifrado autenticado de Laravel. Respaldar y controlar acceso a la clave separadamente de MySQL. No registrar filas, parámetros SQL, credenciales ni respuestas completas en logs. Rotar con `APP_PREVIOUS_KEYS` cuando corresponda y comprobar descifrado de versiones históricas.

## Comandos

Todos los comandos npm siguientes se ejecutan desde la raíz del repositorio:

```powershell
npm run validate
npm run build
npm test
npm run test:backend
npm run sync -- --integration casablanca-altas-bajas --simulate
npm run status
npm run resume -- --run <UUID> --publish
npm run recover -- --integration casablanca-altas-bajas --simulate --publish
npm run unlock -- --integration casablanca-altas-bajas
```

Sin `--send/--publish`, sync sólo extrae y sella el spool. `--publish` implica transferencia y publicación. `resume` lee el UUID y su integración del manifiesto, verifica todo y pregunta al receptor por los lotes aceptados. `recover` procesa pendientes sellados de una integración y modo, ordenados por inicio; un spool fallido de otra empresa no bloquea ésta. Ni resume ni recover consultan SQL.

## Fallos

| Situación | Procedimiento |
|---|---|
| SQL falla a mitad de stream | No hay manifiesto sellado ni envío. Inspeccionar status, preservar evidencia y resolver causa antes de una extracción nueva |
| Internet falla tras sellado | Conservar archivos y clave; resume con el mismo UUID |
| Acuse de lote perdido | El listado remoto revela que el lote ya existe; no duplicar sus filas |
| Lote/UUID reutilizado con distinto contenido | HTTP 409; investigar, no sobrescribir archivos ni inventar otro hash |
| Esquema cambió o fue revocado | Bloquear publicación; revisar manifiesto y solicitar aprobación de nueva versión |
| Resultado vacío | Bloqueado por defecto en agente y receptor; autorizar explícitamente ambos lados sólo si es semánticamente válido |
| Lock tras caída brusca | unlock comprueba que el PID dueño ya no existe; no elimina locks de procesos vivos |
| Spool corrupto o incompleto | No enviar ni modificar lotes. Con el proceso detenido, mover el directorio UUID a cuarentena protegida fuera del spool; documentar incidente y posible hueco de ventana |
| Pendiente más viejo que publicación activa | Publicación rechazada; operador decide cancelar o revisar rollback, nunca sustituir silenciosamente |

Los reintentos HTTP se limitan al número configurado, con backoff exponencial y jitter (máximo 30 s por espera) y timeout por solicitud de 30 s. Se reintentan fallos de red, 429 y 5xx; no conflictos, errores de autenticación ni contrato. No hay reintento automático de ejecución SQL dentro de una captura. La tarea puede reiniciar el proceso, pero recupera pendientes antes de una nueva consulta.

El checkpoint local no es prueba de recepción: si se pierde después de un acuse, la reanudación sigue siendo idempotente. Los archivos de lote y manifiesto se crean con exclusión (`wx`) y fsync antes de sellar. Las garantías de persistencia ante pérdida eléctrica dependen también del sistema de archivos/disco; no se ha ensayado un corte físico de energía.

## Programador de tareas

Los scripts se han preparado, **no se registraron tareas**. Tras aprobaciones, configuración y build:

```powershell
# Genera XML revisable; aún exige autorización de integración en YAML.
.\scripts\windows\Install-SyncTask.ps1 -Integration casablanca-altas-bajas
.\scripts\windows\Test-SyncTask.ps1 -Integration casablanca-altas-bajas

# Acción futura del operador, sólo después de autorización explícita:
# .\scripts\windows\Install-SyncTask.ps1 -Integration casablanca-altas-bajas -Register
```

El XML usa repetición según YAML, límite de duración, inicio con offset de Lima (-05:00), IgnoreNew, recuperación por tres reinicios cada cinco minutos y privilegio mínimo. Run-Sync primero recupera spools y luego ejecuta la nueva captura. Locks locales aportan prevención adicional de solapamiento por integración. Run-All procesa integraciones por separado y reporta errores sin cancelar la otra.

El ejemplo usa InteractiveToken bajo la cuenta actual, sin almacenar contraseñas; no sirve para una cuenta desconectada. La operación desatendida requiere una cuenta de servicio y LogonType acordados con TI, acceso a sus secretos/ACL y permisos de red. No activar sin esa revisión. Los XML y scripts tienen validación sintáctica; la ejecución de tareas reales está pendiente de autorización y prueba en el entorno objetivo.

## Backups y rollback

Respaldar en forma consistente MySQL/InnoDB, los manifiestos aprobados, configuración no secreta, registros de auditoría, spools pendientes y claves por canales separados. Para MySQL utilizar una cuenta de backup específica y `mysqldump --single-transaction` con secretos en archivo protegido o gestor; no poner contraseñas en la línea de comandos. Cifrar backups, limitar retención conforme a PII y probar restauración en una instancia aislada.

Rollback de datos: elegir una publicación histórica del **mismo dataset**, verificar integridad y ejecutar `POST /api/v1/datasets/{id}/rollback` con scope rollback y cuerpo `{publicationId, expectedActivePublicationId}`. HTTP 409 indica que cambió la versión activa; releer y decidir. No borrar staging ni publicaciones ni usar `migrate:rollback` para volver a una captura anterior.

Restauración de desastre: detener escritores, restaurar DB en entorno aislado junto con la versión de código y claves correctas, verificar hashes y lectura de publicaciones, revisar spools pendientes y sólo después autorizar la reconexión de clientes. No se ejecutó un backup/restore productivo. Los tests verifican rollback lógico y reversión de una publicación fallida; un ensayo operativo de recuperación completa sigue pendiente.

No hay purga automática en esta fase. Conservar staging mientras lo referencien publicaciones. Definir retención, borrado seguro, rotación y capacidad antes del uso real.

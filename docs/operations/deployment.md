# Seguridad y futuro despliegue Ubuntu 24.04

Esta guía prepara el despliegue. La configuración del dominio solicitado y Nginx está en [activación del dominio](domain.md). No se han modificado DNS, servicios systemd/Supervisor, reglas de firewall ni recursos del VPS.

## Revisión antes de producción

1. Obtener autorización para SQL privado; comprobar VPN/LAN, certificado con nombre válido, usuario con EXECUTE mínimo, metadatos y permisos efectivos de acceso entre bases. Prohibir roles sysadmin/db_owner y cualquier apertura de SQL a Internet.
2. Revisar los SP sin alterarlos; aprobar 37 columnas y tipos reales, recordsets, ausencia de efectos secundarios, límites, tiempos y semántica exacta de fechas. Inspección pendiente.
3. Resolver el adaptador sin pérdida cuando aparezcan decimal/money/datetime de precisión no soportada o encoding de varchar no verificado. No activar un esquema sólo porque lo pueda describir SQL Server.
4. Para DIAMOND, aplicar la política `preserve-null` autorizada por el usuario para `spListarAltas_Bajas_DB_Prueba`, con el contrato revisado propio. Seguir [la activación de DIAMOND](diamond-agent.md). Un cambio futuro al SP definitivo requiere inspección y revisión adicionales.
5. Definir tokens distintos para ingest/publish/cancel, lectura y rollback, limitados por integración/origen y con expiración/revocación. El agente no recibe un token de lectura.
6. Acordar PII, retención, backups cifrados, responsables, acceso a auditoría y respuesta a incidentes. No incluir datos reales en fixtures.

## Preparación futura del VPS

Ubuntu 24.04, Nginx, PHP 8.3-FPM y extensiones Laravel (`bcmath`, `mbstring`, PDO MySQL, XML, curl, zip, openssl), Composer y MySQL 8/InnoDB con utf8mb4. Ejecutar comprobaciones de plataforma y Composer lock en el host objetivo. El código se probó en Windows/PHP 8.3.28 y MySQL 8.4.7; no se ha certificado Ubuntu ni otra versión de MySQL mediante despliegue.

Preparar un directorio de release, instalar `composer install --no-dev --prefer-dist --optimize-autoloader` y configuración por secretos externos. APP_ENV=production, APP_DEBUG=false, SYNC_ALLOW_FIXTURES=false. No copiar la SQLite, `.local`, los tokens fixture ni `.env` del desarrollo. Dar escritura sólo a storage/bootstrap/cache; el resto debe ser de sólo lectura para PHP-FPM.

Crear un usuario de runtime MySQL con SELECT/INSERT/UPDATE mínimos sobre las tablas necesarias y un usuario de migración separado con DDL. Publicaciones y staging son inmutables a través de la API; reducir también DELETE/UPDATE directos al mínimo operativo. APP_KEY debe estar en un gestor o archivo fuera de la raíz pública, con backup separado. MySQL en loopback o red privada; TLS con verificación si cruza red.

El administrador debe apuntar la raíz web exclusivamente a `backend/public`, habilitar HTTPS con certificado válido, denegar archivos ocultos/backups y establecer límite de body compatible (16 MiB global; 2 MiB canónicos por lote) y timeouts medidos. Se incluye la plantilla `deploy/nginx/api-employeedb.ccruces.com.conf` por solicitud del usuario. Si hay proxy TLS, configurar únicamente IPs de proxy conocidas; no confiar en X-Forwarded-Proto de clientes arbitrarios. Validar que Laravel ve la solicitud como HTTPS.

Hacer backup antes de ejecutar migraciones aditivas. Ejecutarlas sólo sobre la base nueva aprobada usando la cuenta de migración, y comprobar integridad, índices y ruta activa antes de exponer lectores. No ejecutar `migrate:fresh` ni instalar fixtures en producción. La aprobación/importación administrativa de esquemas productivos requiere un procedimiento de cambio adicional; no existe endpoint para que un agente se autoautorice.

Configurar límites de peticiones por identidad, observabilidad, rotación de logs sin payload, alertas de última captura/espacio y capacidad del spool. El rate limiter inicial usa Laravel; probar políticas por token/dataset y carga antes de un uso empresarial elevado. Nginx no debe registrar Authorization ni bodies. Considerar mTLS/allowlist de salida si se exige identidad de dispositivo.

## Verificación posterior autorizada

Prueba de salud sin datos; rechazo anónimo; tokens de scope incorrecto; ingesta sintética controlada con esquema de staging expresamente autorizado; fallos/reintentos; backup y restore; publicación completa y rollback; consistencia entre páginas fijadas a publicationId; monitoreo de huecos de ventana; latencia con volumen real. Luego aprobar por separado la ejecución programada de Windows.

## Dependencias y riesgos pendientes

- CASABLANCA usa mssql para comprobar metadatos y SqlDataReader para la lectura exacta. Ambas conexiones SQL se cifran y tienen la excepción explícita de confianza de certificado solicitada por el usuario; HTTPS al VPS sigue validando su certificado. Las opciones de excepción predeterminan false si se omiten. El árbol npm incluye Azure Identity transitivo y fija `@azure/msal-node=7.1.1` por el aviso del árbol inicial; Azure OAuth no está habilitado. Revalidar el override al actualizar dependencias.
- `npm audit` y Composer audit se ejecutaron; son resultados puntuales, no una garantía permanente. Repetir en CI antes de releases.
- Las claves actuales de desarrollo sólo protegen fixtures. No se han cargado credenciales productivas.
- No hay cursor fiable ni reparación automática de cambios fuera de la ventana. Una sincronización exitosa no garantiza padrón exhaustivo.
- Quedan pendientes carga/soak tests de gran volumen, ensayo de corte eléctrico, pruebas reales de TLS/SQL/SP, restauración operativa, automatización desatendida y despliegue Ubuntu. La entrega es una primera fase local funcional, no una autorización de publicación productiva.

## Referencias técnicas consultadas

[Laravel 12: instalación](https://laravel.com/docs/12.x/installation), [Laravel 12: middleware](https://laravel.com/docs/12.x/middleware) y [node-mssql: streaming, arrayRowMode y TLS](https://tediousjs.github.io/node-mssql/). Las restricciones concretas de conversión se contrastaron además con el código instalado de mssql/tedious.

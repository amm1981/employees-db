# api-employeedb.ccruces.com

El código, las plantillas de entorno y la configuración Nginx apuntan a `https://api-employeedb.ccruces.com`. La configuración está preparada para Ubuntu 24.04/PHP 8.3-FPM con MySQL 8. No se han cambiado DNS ni servidores remotos desde esta estación.

## Activación en el VPS

1. Crear el registro DNS A de `api-employeedb.ccruces.com` hacia la IP pública del VPS. Publicar AAAA sólo si IPv6 está configurado. SQL Server sigue exclusivamente en la red privada.
2. Instalar el código en `/var/www/employees-db`, ejecutar `composer install --no-dev --prefer-dist --optimize-autoloader` en `backend` y preparar su `.env` a partir de `deploy/backend.production.env.example`, inyectando APP_KEY y secretos MySQL. Conservar APP_KEY al actualizar para poder descifrar las capturas existentes.
3. Usar `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://api-employeedb.ccruces.com`, `SYNC_ALLOW_FIXTURES=false`, `CACHE_STORE=database`. Dar escritura a PHP-FPM sólo sobre `storage` y `bootstrap/cache`. No copiar `.env`, bases ni tokens del desarrollo.
4. Tras backup, ejecutar `php artisan migrate --force` y `php artisan workers:index`. Las migraciones son aditivas. No ejecutar migrate:fresh. El indexador verifica hashes y sólo actualiza fechas derivadas de capturas ya almacenadas; no llama a SQL Server ni cambia payloads.
5. Obtener un certificado público válido para el dominio. La plantilla [Nginx](../../deploy/nginx/api-employeedb.ccruces.com.conf) presupone los archivos de Let's Encrypt en `/etc/letsencrypt/live/api-employeedb.ccruces.com/`. El bloque HTTP admite validación ACME en `/var/www/letsencrypt`; para emitir el primer certificado instalar primero sólo ese bloque HTTP, después el bloque HTTPS. No activar el bloque HTTPS antes de que los archivos existan.
6. Instalar el archivo en `sites-available`, habilitarlo en `sites-enabled`, ejecutar `nginx -t` y recargar Nginx sólo si pasa. La raíz es exclusivamente `backend/public`; el socket esperado es `/run/php/php8.3-fpm.sock`. Confirmar ambos en el VPS.
7. Ejecutar `php artisan config:cache` y `php artisan route:cache`; recargar PHP-FPM. Crear cuentas con `consumer:create` según [la guía de consumo](../api/consumer-api.md).
8. Comprobar `/up` por HTTPS, rechazo de consulta anónima, login/consulta/logout con cuenta de prueba aprobada, y deshabilitarla al terminar.

Nginx termina TLS y pasa `HTTPS on` a PHP-FPM; no se necesita confiar en X-Forwarded-Proto. Si después se añade un balanceador, configurar sus IPs expresamente y verificar que clientes arbitrarios no puedan fingir HTTPS. La plantilla desactiva access_log para no guardar query strings y no registra Authorization ni bodies; para habilitar métricas usar un formato que excluya esos valores. El error_log también debe tener acceso restringido y retención acotada.

## Agente Windows

Cuando el VPS y la integración real estén preparados, establecer en el `.env` local del agente:

```dotenv
API_BASE_URL=https://api-employeedb.ccruces.com
```

Mantener `API_INGEST_TOKEN` como token de servicio dedicado al agente. El token obtenido mediante login es exclusivamente de consumo y no debe sustituirlo. Las simulaciones actuales pueden seguir usando `http://127.0.0.1:8000`; no enviar tokens fixture al dominio público.

La preparación de este dominio y del login no resuelve las restricciones de conversión/aprobación SQL ni activa extracciones o tareas programadas. El consumidor recibe datos reales cuando una captura real completa y aprobada haya sido publicada.

# Revisión de DIAMOND BRIDGE

Destino confirmado por el usuario el 31 de octubre de 2026: DIAMOND BRIDGE, mediante `[MarcacionesCB].[dbo].[spListarAltas_Bajas_DB_Prueba]`, sin parámetros. La tarea instalada anteriormente en TI consultaba CASABLANCA; sus capturas de 36 registros no son publicaciones de DIAMOND. Se indicó al operador suspender esa tarea antes de cambiar el destino.

## Metadatos inspeccionados

Se consultó `sys.sp_describe_first_result_set` para el SP autorizado, sin ejecutar el procedimiento de trabajadores ni leer filas personales. La conexión cifrada utilizó la excepción de certificado ya autorizada por el usuario.

- Base que aloja el SP: `MarcacionesCB`.
- Origen declarado: `DIAMOND_BRIDGE_SAC`.
- Dataset independiente: `diamond-bridge-altas-bajas`.
- Columnas reales: 37, en el orden esperado.
- Esquema candidato: [diamond-bridge.candidate-1.json](../../contracts/schemas/diamond-bridge.candidate-1.json).
- SHA-256 del esquema `candidate-1`: `27ac939f10aa4977e1eb5bcb3a3280975d322fddc16de1bafbdfe6b2edd93d60`.

La comparación con el contrato de CASABLANCA muestra una diferencia: `cod_empresa` es nullable en DIAMOND. Es `varchar(2)`, collation `Modern_Spanish_CI_AS`. Las otras 36 columnas coinciden en nombre, tipo, orden, longitud, precisión, escala, nullabilidad y collation. No se debe reutilizar el hash ni la aprobación de CASABLANCA.

El adaptador .NET exacto admite los tipos inspeccionados sin restricciones de conversión pendientes. La configuración prepara ese adaptador y una frecuencia de 15 minutos. La habilitación requiere ejecutar los comandos de activación en TI y VPS.

## Publicación con NULL autorizada

El usuario confirmó expresamente el 31 de octubre de 2026 que se debe usar este SP y publicar conservando `cod_empresa=NULL`. Esta instrucción sustituye la condición inicial de esperar un código de empresa. La política `preserve-null` conserva NULL y rechaza filas productivas con un código añadido.

El contrato revisado `diamond-null-v1` tiene hash `4bea3f9338b98121611b0d29a20362461a84d49ca8c1c5897b0413eb92a59e91`. No se reutiliza la aprobación de CASABLANCA ni se renombran sus publicaciones. La [guía de cambio a DIAMOND](../operations/diamond-agent.md) reasigna los permisos y el token existente exclusivamente al dataset DIAMOND, conserva las credenciales y desactiva la ingesta/publicación de CASABLANCA.

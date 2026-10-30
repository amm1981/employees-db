# Revision del esquema de CASABLANCA

Fecha: 29 de octubre de 2026 (America/Lima). Metadatos aportados por el usuario desde SSMS; no se han consultado filas de trabajadores ni ejecutado el SP de negocio desde el agente.

## Evidencia

- Procedimiento: `[MarcacionesCB].[dbo].[spListarAltas_Bajas_Csb]`.
- Metodo: `sys.dm_exec_describe_first_result_set_for_object`.
- Esquema: `candidate-1`; 37 columnas en el orden esperado.
- SHA-256 del esquema: `e30fd773f9ccc5d0db7c60da4b0adfe19ff7db526e587ec79df8b390a8a21ecd`.
- SHA-256 de la exportacion: `33696fc72e1c2e15978ae86cd79ac199f1b76f1d9fb579162d67dc471090ecb6`.
- Candidato conservado en `contracts/schemas/casablanca.candidate-1.json`; status pending. El esquema y su hash se conservaron sin cambios respecto al archivo importado.

## Interpretacion de los 34 bloqueos

| Grupo | Columnas | Revision necesaria |
|---|---:|---|
| Texto varchar/char con collation no UTF-8 | 27 | Verificar pagina de codigos, conversion sin sustituciones y limites medidos en bytes SQL |
| datetime | 6 | Verificar ida y vuelta entre la representacion SQL de 1/300 s, Date del driver y texto canonico, sin conversion de zona |
| numeric(18,0) | 1 | Conservar id_planilla sin pasar por Number cuando exceda el entero seguro de JavaScript |

Los otros tres campos son int: cod_categoria, tipo_documento e ID_EstadoCivil. El conteo de 34 no significa que se hayan detectado 34 valores corruptos: no se recibieron valores de trabajadores. Indica tipos/codificaciones que la politica conservadora del adaptador aun bloquea.

Texto: aparecen Modern_Spanish_CI_AS y SQL_Latin1_General_CP1_CI_AS. Hay que validar sus paginas de codigos y preservar acentos, caracteres especiales, espacios y bytes no representables sin sustituirlos. El validador actual mide varchar como UTF-8 y debe adaptarse tambien en PHP, no solo retirar el bloqueo del agente.

Datetime: Fnacimiento, fingreso, fcese, updpersonal, updagenda y updu. El driver instalado redondea los ticks SQL a milisegundos. Eso exige demostrar una representacion de texto que preserve el valor SQL al reconstruirlo; no afirmar perdida en todas las fechas sin esa prueba. Fnacimiento es datetime, no date: no recortar la hora por el nombre del campo.

Numeric: id_planilla es obligatorio y numeric(18,0). Su rango declarado excede los enteros seguros de Number; que los datos de una prueba sean pequenos no autoriza una conversion numerica general. El protocolo JSON ya admite su valor exacto como texto, pero la extraccion debe entregarlo sin redondearlo previamente.

## Columnas observadas

| Ordinal | Columna | Tipo SQL | Admite NULL | Collation |
|---:|---|---|---|---|
| 1 | cod_empresa | varchar(2) | No | Modern_Spanish_CI_AS |
| 2 | cod_categoria | int | Si | — |
| 3 | cod_trabajador | varchar(20) | No | SQL_Latin1_General_CP1_CI_AS |
| 4 | apellido_pat | varchar(50) | Si | SQL_Latin1_General_CP1_CI_AS |
| 5 | apellido_mat | varchar(50) | Si | SQL_Latin1_General_CP1_CI_AS |
| 6 | Nombres | varchar(101) | No | SQL_Latin1_General_CP1_CI_AS |
| 7 | tipo_documento | int | No | — |
| 8 | email | varchar(255) | Si | SQL_Latin1_General_CP1_CI_AS |
| 9 | sexo | char(1) | No | SQL_Latin1_General_CP1_CI_AS |
| 10 | ID_EstadoCivil | int | No | — |
| 11 | cod_nacionalidad | varchar(100) | Si | Modern_Spanish_CI_AS |
| 12 | nacionalidad | varchar(50) | Si | SQL_Latin1_General_CP1_CI_AS |
| 13 | tipo_trabajador | varchar(10) | Si | SQL_Latin1_General_CP1_CI_AS |
| 14 | reloj | varchar(1) | No | Modern_Spanish_CI_AS |
| 15 | tipo_asistencia | varchar(1) | No | Modern_Spanish_CI_AS |
| 16 | Fnacimiento | datetime | No | — |
| 17 | cod_proyecto | varchar(2) | No | Modern_Spanish_CI_AS |
| 18 | area | varchar(100) | Si | Modern_Spanish_CI_AS |
| 19 | area_desc | varchar(100) | Si | SQL_Latin1_General_CP1_CI_AS |
| 20 | ccosto | varchar(12) | No | SQL_Latin1_General_CP1_CI_AS |
| 21 | uni_negocio | varchar(12) | Si | SQL_Latin1_General_CP1_CI_AS |
| 22 | planilla | varchar(42) | No | Modern_Spanish_CI_AS |
| 23 | id_planilla | numeric(18,0) | No | — |
| 24 | planilla_desc | varchar(100) | Si | SQL_Latin1_General_CP1_CI_AS |
| 25 | fotocheck | varchar(20) | No | SQL_Latin1_General_CP1_CI_AS |
| 26 | cod_sede | varchar(100) | Si | Modern_Spanish_CI_AS |
| 27 | sede | varchar(50) | Si | SQL_Latin1_General_CP1_CI_AS |
| 28 | cod_cargo | varchar(100) | Si | Modern_Spanish_CI_AS |
| 29 | cargo | varchar(50) | Si | SQL_Latin1_General_CP1_CI_AS |
| 30 | cod_funcion | varchar(100) | Si | Modern_Spanish_CI_AS |
| 31 | funcion | varchar(50) | Si | SQL_Latin1_General_CP1_CI_AS |
| 32 | fingreso | datetime | No | — |
| 33 | fcese | datetime | Si | — |
| 34 | estado | varchar(1) | No | Modern_Spanish_CI_AS |
| 35 | updpersonal | datetime | Si | — |
| 36 | updagenda | datetime | Si | — |
| 37 | updu | datetime | Si | — |

## Estado y pasos siguientes

1. Implementar y verificar conversiones con datos ficticios del esquema observado, incluyendo limites de precision y longitud. No modificar los SP ni inferir tipos de muestras.
2. Resolver la confianza TLS antes de una extraccion directa autorizada. La inspeccion directa ya fue verificada con la excepcion de certificado solicitada por el usuario, y su hash coincide con SSMS; esa excepcion no habilita la extraccion.
3. Revisar/aprobar el contrato y realizar una prueba real controlada solo con autorizacion especifica para ejecutar el SP. La autorizacion anterior cubre inspeccion de metadatos.
4. Aprobar la publicacion por separado. Ninguna bandera ni esquema activo se habilito con esta revision.

La semantica continua siendo ROLLING_WINDOW_CAPTURE, no padron completo. Diamond Bridge sigue sin codigo de empresa aprobado y sin esquema propio verificado.

## Referencias

[Microsoft: datetime](https://learn.microsoft.com/en-us/sql/t-sql/data-types/datetime-transact-sql) y [Microsoft: collations y Unicode](https://learn.microsoft.com/en-us/sql/relational-databases/collations/collation-and-unicode-support/). La revision del driver se contrasto con node_modules/tedious/lib/value-parser.js: readNumeric y readDateTime.

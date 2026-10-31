using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Data.SqlTypes;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace GetEmployes
{
    public sealed class ExactColumn
    {
        public string name { get; set; }
        public string sqlType { get; set; }
        public bool nullable { get; set; }
        public int maxLength { get; set; }
        public int precision { get; set; }
        public int scale { get; set; }
        public string collation { get; set; }
    }
    public sealed class ExactSchema
    {
        public ExactColumn[] columns { get; set; }
    }
    public sealed class ExactConfig
    {
        public string integration { get; set; }
        public string procedure { get; set; }
        public string serverEnv { get; set; }
        public string portEnv { get; set; }
        public string userEnv { get; set; }
        public string passwordEnv { get; set; }
        public int connectionTimeoutMs { get; set; }
        public int timeoutMs { get; set; }
        public bool trustServerCertificate { get; set; }
        public int rowLimit { get; set; }
        public ExactSchema schema { get; set; }
    }
    public sealed class ExactFailure : Exception
    {
        public ExactFailure(string code) : base(code) { }
    }
    public static class SqlExactReader
    {
        static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;
        static readonly Encoding Cp1252 = Encoding.GetEncoding(1252, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);
        static readonly string[] Names = ("cod_empresa,cod_categoria,cod_trabajador,apellido_pat,apellido_mat,Nombres,tipo_documento,email,sexo,ID_EstadoCivil,cod_nacionalidad,nacionalidad,tipo_trabajador,reloj,tipo_asistencia,Fnacimiento,cod_proyecto,area,area_desc,ccosto,uni_negocio,planilla,id_planilla,planilla_desc,fotocheck,cod_sede,sede,cod_cargo,cargo,cod_funcion,funcion,fingreso,fcese,estado,updpersonal,updagenda,updu").Split(',');

        // Typed accessors are essential: Decimal would truncate SqlDecimal(38),
        // and JavaScript Number cannot represent all numeric(18,0) values.
        public static string Format(object value, string type, int scale)
        {
            if (value == null || value == DBNull.Value) return null;
            switch (type)
            {
                case "decimal": case "numeric": return ((SqlDecimal)value).ToString();
                case "money": case "smallmoney": return ((decimal)value).ToString("0.0000", Invariant);
                case "datetime": return ((DateTime)value).ToString("yyyy-MM-dd'T'HH:mm:ss.fff", Invariant);
                case "smalldatetime": return ((DateTime)value).ToString("yyyy-MM-dd'T'HH:mm:ss", Invariant);
                case "date": return ((DateTime)value).ToString("yyyy-MM-dd", Invariant);
                case "datetime2": return ((DateTime)value).ToString("yyyy-MM-dd'T'HH:mm:ss" + Fraction(scale), Invariant);
                case "datetimeoffset": return ((DateTimeOffset)value).ToString("yyyy-MM-dd'T'HH:mm:ss" + Fraction(scale) + "zzz", Invariant);
                case "time": return ((TimeSpan)value).ToString(@"hh\:mm\:ss" + (scale > 0 ? @"\." + new string('f', scale) : ""), Invariant);
                case "bit": return (bool)value ? "1" : "0";
                case "float": return ((double)value).ToString("R", Invariant);
                case "real": return ((float)value).ToString("R", Invariant);
                case "binary": case "varbinary": case "image": return BitConverter.ToString((byte[])value).Replace("-", "").ToLowerInvariant();
                default: return Convert.ToString(value, Invariant);
            }
        }
        static string Fraction(int scale)
        {
            if (scale < 0 || scale > 7) throw new ExactFailure("SQL_TIME_SCALE_INVALID");
            return scale == 0 ? "" : "." + new string('f', scale);
        }
        static bool Text(string type) { return type == "varchar" || type == "char" || type == "text" || type == "nvarchar" || type == "nchar" || type == "ntext"; }
        static bool Binary(string type) { return type == "binary" || type == "varbinary" || type == "image"; }
        public static void ValidateText(string value, ExactColumn column)
        {
            if (column.sqlType == "varchar" || column.sqlType == "char" || column.sqlType == "text")
            {
                // Only the two inspected legacy collations are approved.
                if (column.collation != "SQL_Latin1_General_CP1_CI_AS" && column.collation != "Modern_Spanish_CI_AS") throw new ExactFailure("SQL_ENCODING_NOT_VERIFIED");
                byte[] bytes = Cp1252.GetBytes(value);
                if (Cp1252.GetString(bytes) != value) throw new ExactFailure("SQL_ENCODING_ROUNDTRIP");
                if (column.sqlType != "text" && column.maxLength >= 0 && bytes.Length > column.maxLength) throw new ExactFailure("ROW_SIZE");
            }
        }
        // GetChars/GetBytes consume the column in SequentialAccess mode. Never
        // follow a length probe with GetValue on that same column. Stream once,
        // with a bounded buffer, including values whose length is unknown (MAX).
        public static string ReadCell(IDataRecord reader, int ordinal, ExactColumn column, int remaining)
        {
            if (remaining < 0) throw new ExactFailure("ROW_SIZE");
            if (reader.IsDBNull(ordinal))
            {
                if (!column.nullable) throw new ExactFailure("ROW_NULL");
                return null;
            }
            string value;
            if (Text(column.sqlType))
            {
                char[] buffer = new char[Math.Min(4096, remaining + 1)];
                StringBuilder text = new StringBuilder();
                long offset = 0, count;
                while ((count = reader.GetChars(ordinal, offset, buffer, 0, Math.Min(buffer.Length, remaining - text.Length + 1))) != 0)
                {
                    if (count > remaining - text.Length) throw new ExactFailure("ROW_SIZE");
                    text.Append(buffer, 0, (int)count);
                    offset += count;
                }
                value = text.ToString();
                ValidateText(value, column);
            }
            else if (Binary(column.sqlType))
            {
                int limit = remaining / 2;
                byte[] buffer = new byte[Math.Min(4096, limit + 1)];
                using (MemoryStream bytes = new MemoryStream())
                {
                    long count;
                    while ((count = reader.GetBytes(ordinal, bytes.Length, buffer, 0, (int)Math.Min(buffer.Length, limit - bytes.Length + 1))) != 0)
                    {
                        if (count > limit - bytes.Length) throw new ExactFailure("ROW_SIZE");
                        bytes.Write(buffer, 0, (int)count);
                    }
                    value = Format(bytes.ToArray(), column.sqlType, column.scale);
                }
            }
            else
            {
                object raw = column.sqlType == "decimal" || column.sqlType == "numeric" ? (object)((SqlDataReader)reader).GetSqlDecimal(ordinal) : reader.GetValue(ordinal);
                value = Format(raw, column.sqlType, column.scale);
            }
            if (value.Length > remaining) throw new ExactFailure("ROW_SIZE");
            return value;
        }
        public static string FailureCode(Exception error)
        {
            // This fixed vocabulary must never include exception messages,
            // connection strings, server addresses or worker values.
            if (error is InvalidOperationException) return "INVALID_OPERATION";
            if (error is InvalidCastException) return "INVALID_CAST";
            if (error is ArgumentException) return "ARGUMENT";
            if (error is FormatException) return "FORMAT";
            if (error is OverflowException) return "OVERFLOW";
            if (error is IOException) return "IO";
            return "UNEXPECTED";
        }
        static void ValidateRecordset(SqlDataReader reader, ExactSchema schema)
        {
            if (reader.FieldCount != Names.Length || schema.columns.Length != Names.Length) throw new ExactFailure("SQL_RECORDSET_CHANGED");
            DataTable metadata = reader.GetSchemaTable();
            for (int i = 0; i < Names.Length; i++)
            {
                ExactColumn c = schema.columns[i];
                string type = reader.GetDataTypeName(i).ToLowerInvariant();
                // SqlClient calls SQL numeric "decimal". Both represent the
                // same TDS numeric type; precision/scale remain checked below.
                if (type == "decimal" && c.sqlType == "numeric") type = "numeric";
                if (c.name != Names[i] || reader.GetName(i) != c.name || type != c.sqlType) throw new ExactFailure("SQL_RECORDSET_CHANGED");
                DataRow m = metadata.Rows[i];
                if (Convert.ToBoolean(m["AllowDBNull"], Invariant) != c.nullable) throw new ExactFailure("SQL_NULLABILITY_CHANGED_" + i);
                if ((type == "varchar" || type == "char" || type == "nvarchar" || type == "nchar" || type == "binary" || type == "varbinary") && c.maxLength >= 0)
                {
                    int expected = type == "nvarchar" || type == "nchar" || type == "ntext" ? c.maxLength / 2 : c.maxLength;
                    if (Convert.ToInt32(m["ColumnSize"], Invariant) != expected) throw new ExactFailure("SQL_LENGTH_CHANGED_" + i);
                }
                if (type == "decimal" || type == "numeric")
                    if (Convert.ToInt32(m["NumericPrecision"], Invariant) != c.precision || Convert.ToInt32(m["NumericScale"], Invariant) != c.scale) throw new ExactFailure("SQL_NUMERIC_CHANGED_" + i);
                if (type == "datetime2" || type == "datetimeoffset" || type == "time")
                    if (Convert.ToInt32(m["NumericScale"], Invariant) != c.scale) throw new ExactFailure("SQL_TIME_SCALE_CHANGED");
            }
        }
        static string Required(string key)
        {
            string value = Environment.GetEnvironmentVariable(key);
            if (String.IsNullOrEmpty(value)) throw new ExactFailure("SQL_SECRET_MISSING");
            return value;
        }
        public static int Run(string input)
        {
            Thread.CurrentThread.CurrentCulture = Invariant;
            Console.OutputEncoding = new UTF8Encoding(false, true);
            JavaScriptSerializer json = new JavaScriptSerializer();
            json.MaxJsonLength = 16 * 1024 * 1024;
            string stage = "CONFIG";
            try
            {
                ExactConfig c = json.Deserialize<ExactConfig>(input);
                string allowed = c.integration == "casablanca-altas-bajas" ? "[MarcacionesCB].[dbo].[spListarAltas_Bajas_Csb]" : c.integration == "diamond-bridge-altas-bajas" ? "[MarcacionesCB].[dbo].[spListarAltas_Bajas_DB_Prueba]" : null;
                if (allowed == null || c.procedure != allowed || c.rowLimit < 1 || c.rowLimit > 2097152 || c.timeoutMs < 1 || c.timeoutMs > 3600000 || c.connectionTimeoutMs < 1 || c.schema == null) throw new ExactFailure("UNAUTHORIZED_SQL_TARGET");
                int port;
                string rawPort = Environment.GetEnvironmentVariable(c.portEnv) ?? "1433";
                if (!Int32.TryParse(rawPort, out port) || port < 1 || port > 65535) throw new ExactFailure("SQL_PORT_INVALID");
                SqlConnectionStringBuilder options = new SqlConnectionStringBuilder();
                options.DataSource = Required(c.serverEnv) + "," + port;
                options.InitialCatalog = "MarcacionesCB";
                options.UserID = Required(c.userEnv);
                options.Password = Required(c.passwordEnv);
                options.Encrypt = true;
                options.TrustServerCertificate = c.trustServerCertificate;
                options.PersistSecurityInfo = false;
                options.Pooling = false;
                options.ApplicationName = "GET-Employes exact reader";
                options.ConnectTimeout = (int)Math.Ceiling(c.connectionTimeoutMs / 1000.0);
                using (SqlConnection connection = new SqlConnection(options.ConnectionString))
                {
                    stage = "CONNECT";
                    connection.Open();
                    using (SqlCommand command = new SqlCommand(allowed, connection))
                    {
                        command.CommandType = CommandType.StoredProcedure;
                        command.CommandTimeout = (int)Math.Ceiling(c.timeoutMs / 1000.0);
                        stage = "EXECUTE";
                        using (SqlDataReader reader = command.ExecuteReader(CommandBehavior.SequentialAccess))
                        {
                            stage = "RECORDSET";
                            ValidateRecordset(reader, c.schema);
                            Console.Out.WriteLine("{\"kind\":\"ready\"}");
                            long count = 0;
                            stage = "READ_ROW";
                            while (reader.Read())
                            {
                                string[] values = new string[Names.Length];
                                int characters = 0;
                                for (int i = 0; i < values.Length; i++)
                                {
                                    ExactColumn col = c.schema.columns[i];
                                    stage = "READ_CELL_" + i;
                                    values[i] = ReadCell(reader, i, col, c.rowLimit - characters);
                                    if (values[i] != null) characters += values[i].Length;
                                }
                                stage = "SERIALIZE";
                                Console.Out.WriteLine(json.Serialize(new { kind = "row", values = values }));
                                count++;
                                stage = "READ_ROW";
                            }
                            stage = "NEXT_RESULT";
                            if (reader.NextResult()) throw new ExactFailure("MULTIPLE_RECORDSETS");
                            stage = "COMPLETE";
                            Console.Out.WriteLine(json.Serialize(new { kind = "complete", count = count }));
                            Console.Out.Flush();
                        }
                    }
                }
                return 0;
            }
            catch (ExactFailure error) { Console.Out.WriteLine(json.Serialize(new { kind = "error", code = error.Message })); }
            catch (EncoderFallbackException) { Console.Out.WriteLine("{\"kind\":\"error\",\"code\":\"SQL_ENCODING_ROUNDTRIP\"}"); }
            catch (SqlException error) { Console.Out.WriteLine(json.Serialize(new { kind = "error", code = error.Number == 18456 ? "SQL_ELOGIN" : error.Number == -2 ? "SQL_REQUEST_TIMEOUT" : "SQL_EXTRACTION_FAILED" })); }
            catch (Exception error) { Console.Out.WriteLine(json.Serialize(new { kind = "error", code = "SQL_BRIDGE_" + stage + "_" + FailureCode(error) })); }
            return 1;
        }
    }
}

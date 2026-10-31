using System;
using System.Data;
using System.IO;

namespace GetEmployes
{
    // Offline regression: forward-only chunks, short reads, no GetValue after
    // chunk access, and synthetic values only. No SQL connection is opened.
    public static class SqlExactReaderTests
    {
        sealed class SequentialRecord : IDataRecord
        {
            readonly IDataRecord inner;
            int column = -1;
            long offset;
            bool chunks;
            public SequentialRecord(IDataRecord inner) { this.inner = inner; }
            void Advance(int ordinal)
            {
                if (ordinal < column) throw new InvalidOperationException("SYNTHETIC_PRIVATE_VALUE");
                if (ordinal > column) { column = ordinal; offset = 0; chunks = false; }
            }
            public long GetChars(int i, long fieldOffset, char[] buffer, int bufferOffset, int length)
            {
                Advance(i);
                if (fieldOffset != offset) throw new InvalidOperationException("SYNTHETIC_PRIVATE_VALUE");
                chunks = true;
                string value = (string)inner.GetValue(i);
                if (buffer == null) return value.Length;
                int count = (int)Math.Min(value.Length - fieldOffset, Math.Min(length, 17));
                value.CopyTo((int)fieldOffset, buffer, bufferOffset, count);
                offset += count;
                return count;
            }
            public long GetBytes(int i, long fieldOffset, byte[] buffer, int bufferOffset, int length)
            {
                Advance(i);
                if (fieldOffset != offset) throw new InvalidOperationException("SYNTHETIC_PRIVATE_VALUE");
                chunks = true;
                byte[] value = (byte[])inner.GetValue(i);
                if (buffer == null) return value.Length;
                int count = (int)Math.Min(value.Length - fieldOffset, Math.Min(length, 17));
                Array.Copy(value, (int)fieldOffset, buffer, bufferOffset, count);
                offset += count;
                return count;
            }
            public object GetValue(int i)
            {
                Advance(i);
                if (chunks) throw new InvalidOperationException("SYNTHETIC_PRIVATE_VALUE");
                return inner.GetValue(i);
            }
            public bool IsDBNull(int i) { Advance(i); return inner.IsDBNull(i); }
            public int FieldCount { get { return inner.FieldCount; } }
            public object this[int i] { get { return GetValue(i); } }
            public object this[string name] { get { return GetValue(GetOrdinal(name)); } }
            public string GetName(int i) { return inner.GetName(i); }
            public string GetDataTypeName(int i) { return inner.GetDataTypeName(i); }
            public Type GetFieldType(int i) { return inner.GetFieldType(i); }
            public int GetOrdinal(string name) { return inner.GetOrdinal(name); }
            public bool GetBoolean(int i) { return (bool)GetValue(i); }
            public byte GetByte(int i) { return (byte)GetValue(i); }
            public char GetChar(int i) { return (char)GetValue(i); }
            public Guid GetGuid(int i) { return (Guid)GetValue(i); }
            public short GetInt16(int i) { return (short)GetValue(i); }
            public int GetInt32(int i) { return (int)GetValue(i); }
            public long GetInt64(int i) { return (long)GetValue(i); }
            public float GetFloat(int i) { return (float)GetValue(i); }
            public double GetDouble(int i) { return (double)GetValue(i); }
            public string GetString(int i) { return (string)GetValue(i); }
            public decimal GetDecimal(int i) { return (decimal)GetValue(i); }
            public DateTime GetDateTime(int i) { return (DateTime)GetValue(i); }
            public IDataReader GetData(int i) { throw new NotSupportedException(); }
            public int GetValues(object[] values) { throw new NotSupportedException(); }
        }
        static SequentialRecord Record(object value, Type type)
        {
            DataTable table = new DataTable();
            table.Columns.Add("synthetic", type);
            table.Rows.Add(new object[] { value });
            DataTableReader reader = table.CreateDataReader();
            reader.Read();
            return new SequentialRecord(reader);
        }
        static ExactColumn Column(string type)
        {
            return new ExactColumn { sqlType = type, nullable = true, maxLength = -1, collation = "Modern_Spanish_CI_AS" };
        }
        static void Check(bool condition) { if (!condition) throw new Exception("SEQUENTIAL_REGRESSION_FAILED"); }
        static void Reject(Action action, string code)
        {
            try { action(); }
            catch (ExactFailure error) { Check(error.Message == code); return; }
            throw new Exception("EXPECTED_SEQUENTIAL_REJECTION");
        }
        public static void Run()
        {
            string text = new string((char)0xF1, 9001) + "  ";
            SequentialRecord old = Record(text, typeof(string));
            old.GetChars(0, 0, null, 0, 0);
            bool reproduced = false;
            try { old.GetValue(0); }
            catch (InvalidOperationException) { reproduced = true; }
            Check(reproduced);
            Check(SqlExactReader.ReadCell(Record(text, typeof(string)), 0, Column("varchar"), text.Length) == text);
            Check(SqlExactReader.ReadCell(Record("", typeof(string)), 0, Column("varchar"), 0) == "");
            Check(SqlExactReader.ReadCell(Record(DBNull.Value, typeof(string)), 0, Column("varchar"), 0) == null);
            string unicode = new string('A', 4095) + Char.ConvertFromUtf32(0x1F600);
            Check(SqlExactReader.ReadCell(Record(unicode, typeof(string)), 0, Column("nvarchar"), unicode.Length) == unicode);
            byte[] binary = new byte[8201];
            for (int i = 0; i < binary.Length; i++) binary[i] = (byte)(i % 256);
            string expected = BitConverter.ToString(binary).Replace("-", "").ToLowerInvariant();
            Check(SqlExactReader.ReadCell(Record(binary, typeof(byte[])), 0, Column("varbinary"), expected.Length) == expected);
            Check(SqlExactReader.ReadCell(Record(new byte[0], typeof(byte[])), 0, Column("varbinary"), 0) == "");
            Check(SqlExactReader.ReadCell(Record(0, typeof(int)), 0, Column("int"), 1) == "0");
            Reject(delegate { SqlExactReader.ReadCell(Record(text, typeof(string)), 0, Column("varchar"), text.Length - 1); }, "ROW_SIZE");
            Reject(delegate { SqlExactReader.ReadCell(Record("A", typeof(string)), 0, Column("varchar"), 0); }, "ROW_SIZE");
            Reject(delegate { SqlExactReader.ReadCell(Record(binary, typeof(byte[])), 0, Column("varbinary"), expected.Length - 1); }, "ROW_SIZE");
            ExactColumn required = Column("varchar"); required.nullable = false;
            Reject(delegate { SqlExactReader.ReadCell(Record(DBNull.Value, typeof(string)), 0, required, 0); }, "ROW_NULL");
            Check(SqlExactReader.FailureCode(new InvalidOperationException("SYNTHETIC_PRIVATE_VALUE")) == "INVALID_OPERATION");
            Check(SqlExactReader.FailureCode(new Exception("SYNTHETIC_PRIVATE_VALUE")) == "UNEXPECTED");
            Check(SqlExactReader.FailureCode(new IOException("SYNTHETIC_PRIVATE_VALUE")) == "IO");
        }
    }
}

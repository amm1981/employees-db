$ErrorActionPreference = 'Stop'
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'SqlExactReader.cs') -ReferencedAssemblies System.Data,System.Web.Extensions,System.Xml
    exit ([GetEmployes.SqlExactReader]::Run([Console]::In.ReadToEnd()))
} catch {
    # Never expose SQL exception messages, connection strings or row values.
    [Console]::Out.WriteLine('{"kind":"error","code":"SQL_BRIDGE_START_FAILED"}')
    exit 1
}

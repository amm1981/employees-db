/* SQL Server 2016+. Metadata-only export for GET-Employes.
   Run manually in the already authorized SSMS session.
   This inspects the existing procedure; it does not execute or alter it.
   Copy the single JSON result cell to an UTF-8 .json file, without headers.
   Do not substitute employee data or types inferred from sample rows. */
USE [MarcacionesCB];
SET NOCOUNT ON;

DECLARE @procedureId int = OBJECT_ID(N'[dbo].[spListarAltas_Bajas_Csb]', N'P');
IF @procedureId IS NULL
BEGIN
    RAISERROR('The authorized procedure does not exist or is not visible to this account.', 16, 1);
    RETURN;
END;

DECLARE @metadata nvarchar(max) = (
    SELECT
        column_ordinal, is_hidden, name, system_type_name, is_nullable,
        max_length, [precision], [scale], collation_name, user_type_name,
        error_number
    FROM sys.dm_exec_describe_first_result_set_for_object(@procedureId, 0)
    ORDER BY column_ordinal
    FOR JSON PATH, INCLUDE_NULL_VALUES
);

SELECT
    1 AS exportVersion,
    N'casablanca-altas-bajas' AS integrationId,
    DB_NAME() AS [database],
    N'[MarcacionesCB].[dbo].[spListarAltas_Bajas_Csb]' AS [procedure],
    N'sys.dm_exec_describe_first_result_set_for_object' AS method,
    JSON_QUERY(@metadata) AS metadata
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;

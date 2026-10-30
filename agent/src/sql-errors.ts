// Only controlled error codes leave the SQL adapter. Driver messages can contain
// server addresses, account names and other connection details.
export function connectionErrorCode(error: unknown): string {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  const codes = new Set<string>();
  while (pending.length && seen.size < 24) {
    const item = pending.shift();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const value = item as {
      code?: unknown;
      cause?: unknown;
      originalError?: unknown;
      errors?: unknown;
    };
    if (typeof value.code === "string") codes.add(value.code);
    pending.push(value.cause, value.originalError);
    if (Array.isArray(value.errors)) pending.push(...value.errors.slice(0, 8));
  }
  const has = (...values: string[]) => values.some((v) => codes.has(v));
  if (has("ERR_TLS_CERT_ALTNAME_INVALID")) return "SQL_TLS_HOSTNAME_MISMATCH";
  if (has("CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID"))
    return "SQL_TLS_CERTIFICATE_DATE_INVALID";
  if (
    has(
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    )
  )
    return "SQL_TLS_CA_UNTRUSTED";
  if (has("ECONNREFUSED")) return "SQL_TCP_CONNECTION_REFUSED";
  if (has("ENOTFOUND", "EAI_AGAIN")) return "SQL_DNS_LOOKUP_FAILED";
  if (has("EHOSTUNREACH", "ENETUNREACH")) return "SQL_NETWORK_UNREACHABLE";
  if (has("ETIMEDOUT", "ETIMEOUT")) return "SQL_CONNECTION_TIMEOUT";
  if (has("ECONNRESET")) return "SQL_CONNECTION_RESET";
  for (const code of ["ELOGIN", "ESOCKET", "EINSTLOOKUP"])
    if (codes.has(code)) return `SQL_${code}`;
  return "SQL_CONNECTION_FAILED";
}

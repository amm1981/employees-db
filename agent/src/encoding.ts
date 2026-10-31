export const cp1252Collations = new Set([
  "SQL_Latin1_General_CP1_CI_AS",
  "Modern_Spanish_CI_AS",
]);
const extra = new Set(
  Array.from("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\u0081\u008d\u008f\u0090\u009d"),
);

export function varcharBytes(value: string, collation: string | null): number {
  if (!cp1252Collations.has(collation ?? ""))
    return Buffer.byteLength(value, "utf8");
  let length = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (!(code <= 0x7f || (code >= 0xa0 && code <= 0xff) || extra.has(char)))
      throw new Error("ROW_ENCODING");
    length++;
  }
  return length;
}

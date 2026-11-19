/** Quote a value for a POSIX shell assignment. */
export function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

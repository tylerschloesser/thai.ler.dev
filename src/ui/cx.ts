/** Joins truthy class name fragments with a space. Local to src/ui so the
 * kit doesn't reach into src/lib. */
export function cx(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(' ')
}

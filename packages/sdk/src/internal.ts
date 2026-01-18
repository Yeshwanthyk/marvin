export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error) return value.message
  return typeof value === "string" ? value : String(value)
}

import { isRecord, toErrorMessage } from "./internal.js"

export type SdkErrorTag = "ConfigError" | "RuntimeError" | "TransportError" | "HookError"

export type SdkError = {
  _tag: SdkErrorTag
  message: string
  cause?: string
}

const isSdkErrorTag = (value: unknown): value is SdkErrorTag =>
  value === "ConfigError" ||
  value === "RuntimeError" ||
  value === "TransportError" ||
  value === "HookError"

export const isSdkError = (value: unknown): value is SdkError => {
  if (!isRecord(value)) return false
  const tag = value["_tag"]
  const message = value["message"]
  if (!isSdkErrorTag(tag) || typeof message !== "string") return false
  const cause = value["cause"]
  if (cause !== undefined && typeof cause !== "string") return false
  return true
}

export const toSdkError = (value: unknown, fallbackTag: SdkErrorTag = "RuntimeError"): SdkError => {
  if (isSdkError(value)) return value
  return { _tag: fallbackTag, message: toErrorMessage(value) }
}

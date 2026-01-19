import { isRecord, toErrorMessage } from "./internal.js"

// Error codes for each category
export type ConfigErrorCode = "CONFIG_MISSING" | "CONFIG_INVALID"
export type ProviderErrorCode = "AUTH" | "RATE_LIMITED" | "OVERLOADED" | "MODEL_NOT_FOUND"
export type RequestErrorCode = "TIMEOUT" | "ABORTED" | "CONTEXT_LENGTH" | "NETWORK"
export type HookErrorCode = "HOOK_FAILED"

// Discriminated union of all SDK errors
export type SdkError =
  | { readonly _tag: "ConfigError"; readonly code: ConfigErrorCode; readonly message: string; readonly retryable: false }
  | { readonly _tag: "ProviderError"; readonly code: ProviderErrorCode; readonly message: string; readonly retryable: boolean }
  | { readonly _tag: "RequestError"; readonly code: RequestErrorCode; readonly message: string; readonly retryable: boolean }
  | { readonly _tag: "HookError"; readonly code: HookErrorCode; readonly message: string; readonly retryable: false }

// Legacy tag type for backward compatibility
export type SdkErrorTag = SdkError["_tag"]

// Error constructors
export const ConfigError = (code: ConfigErrorCode, message: string): SdkError =>
  ({ _tag: "ConfigError", code, message, retryable: false })

export const ProviderError = (code: ProviderErrorCode, message: string): SdkError => ({
  _tag: "ProviderError",
  code,
  message,
  retryable: code === "RATE_LIMITED" || code === "OVERLOADED",
})

export const RequestError = (code: RequestErrorCode, message: string): SdkError => ({
  _tag: "RequestError",
  code,
  message,
  retryable: code === "NETWORK" || code === "TIMEOUT",
})

export const HookError = (message: string): SdkError =>
  ({ _tag: "HookError", code: "HOOK_FAILED", message, retryable: false })

// Pattern matching for error classification
const NETWORK_PATTERNS = [
  "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "EPIPE", "socket hang up",
  "network error", "Failed to fetch", "fetch failed", "ETIMEDOUT",
  "ENOTFOUND", "TLS handshake timeout",
] as const

const RATE_LIMIT_PATTERNS = [
  "rate limit", "too many requests", "exceeded your current quota", "429",
] as const

const AUTH_PATTERNS = [
  "invalid api key", "unauthorized", "access denied", "permission", "401",
] as const

const OVERLOAD_PATTERNS = [
  "overloaded", "at capacity", "service unavailable", "bad gateway", "503", "502",
] as const

const CONTEXT_LENGTH_PATTERNS = [
  "context length", "too many tokens", "maximum context", "token limit",
] as const

const TIMEOUT_PATTERNS = [
  "timeout", "timed out", "deadline exceeded",
] as const

const matchesPattern = (message: string, patterns: readonly string[]): boolean => {
  const lower = message.toLowerCase()
  return patterns.some((p) => lower.includes(p.toLowerCase()))
}

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error as { name?: unknown }).name === "AbortError"

export const isSdkError = (value: unknown): value is SdkError => {
  if (!isRecord(value)) return false
  const tag = value["_tag"]
  return tag === "ConfigError" || tag === "ProviderError" || tag === "RequestError" || tag === "HookError"
}

export const toSdkError = (value: unknown, fallbackTag: SdkErrorTag = "RequestError"): SdkError => {
  if (isSdkError(value)) return value

  const message = toErrorMessage(value)

  // Check for abort
  if (isAbortError(value) || message.toLowerCase().includes("aborted")) {
    return RequestError("ABORTED", message)
  }

  // Check for timeout
  if (matchesPattern(message, TIMEOUT_PATTERNS)) {
    return RequestError("TIMEOUT", message)
  }

  // Classify by pattern
  if (matchesPattern(message, AUTH_PATTERNS)) {
    return ProviderError("AUTH", message)
  }
  if (matchesPattern(message, RATE_LIMIT_PATTERNS)) {
    return ProviderError("RATE_LIMITED", message)
  }
  if (matchesPattern(message, OVERLOAD_PATTERNS)) {
    return ProviderError("OVERLOADED", message)
  }
  if (matchesPattern(message, CONTEXT_LENGTH_PATTERNS)) {
    return RequestError("CONTEXT_LENGTH", message)
  }
  if (matchesPattern(message, NETWORK_PATTERNS)) {
    return RequestError("NETWORK", message)
  }

  // Fallback based on hint
  switch (fallbackTag) {
    case "ConfigError":
      return ConfigError("CONFIG_INVALID", message)
    case "HookError":
      return HookError(message)
    case "ProviderError":
      return ProviderError("MODEL_NOT_FOUND", message)
    default:
      return RequestError("NETWORK", message)
  }
}

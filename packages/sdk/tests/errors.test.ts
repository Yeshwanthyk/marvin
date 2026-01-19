import { describe, it, expect } from "bun:test"
import { toSdkError, ProviderError, RequestError, ConfigError, HookError } from "../src/errors.js"

describe("error classification", () => {
  it("classifies rate limit errors", () => {
    const error = toSdkError(new Error("rate limit exceeded"))
    expect(error._tag).toBe("ProviderError")
    if (error._tag === "ProviderError") {
      expect(error.code).toBe("RATE_LIMITED")
      expect(error.retryable).toBe(true)
    }
  })

  it("classifies auth errors", () => {
    const error = toSdkError(new Error("invalid api key"))
    expect(error._tag).toBe("ProviderError")
    if (error._tag === "ProviderError") {
      expect(error.code).toBe("AUTH")
      expect(error.retryable).toBe(false)
    }
  })

  it("classifies abort errors", () => {
    const abortError = new DOMException("Aborted", "AbortError")
    const error = toSdkError(abortError)
    expect(error._tag).toBe("RequestError")
    if (error._tag === "RequestError") {
      expect(error.code).toBe("ABORTED")
    }
  })

  it("classifies network errors", () => {
    const error = toSdkError(new Error("ECONNREFUSED"))
    expect(error._tag).toBe("RequestError")
    if (error._tag === "RequestError") {
      expect(error.code).toBe("NETWORK")
      expect(error.retryable).toBe(true)
    }
  })

  it("classifies timeout errors", () => {
    const error = toSdkError(new Error("request timed out"))
    expect(error._tag).toBe("RequestError")
    if (error._tag === "RequestError") {
      expect(error.code).toBe("TIMEOUT")
      expect(error.retryable).toBe(true)
    }
  })

  it("classifies context length errors", () => {
    const error = toSdkError(new Error("context length exceeded"))
    expect(error._tag).toBe("RequestError")
    if (error._tag === "RequestError") {
      expect(error.code).toBe("CONTEXT_LENGTH")
      expect(error.retryable).toBe(false)
    }
  })

  it("classifies overload errors", () => {
    const error = toSdkError(new Error("service unavailable"))
    expect(error._tag).toBe("ProviderError")
    if (error._tag === "ProviderError") {
      expect(error.code).toBe("OVERLOADED")
      expect(error.retryable).toBe(true)
    }
  })

  it("preserves existing SdkError", () => {
    const original = ProviderError("AUTH", "bad key")
    const error = toSdkError(original)
    expect(error).toBe(original)
  })
})

describe("error constructors", () => {
  it("ConfigError is not retryable", () => {
    const error = ConfigError("CONFIG_MISSING", "No config found")
    expect(error._tag).toBe("ConfigError")
    expect(error.code).toBe("CONFIG_MISSING")
    expect(error.retryable).toBe(false)
  })

  it("ConfigError CONFIG_INVALID", () => {
    const error = ConfigError("CONFIG_INVALID", "Invalid config")
    expect(error.code).toBe("CONFIG_INVALID")
    expect(error.retryable).toBe(false)
  })

  it("ProviderError RATE_LIMITED is retryable", () => {
    const error = ProviderError("RATE_LIMITED", "Too many requests")
    expect(error._tag).toBe("ProviderError")
    expect(error.retryable).toBe(true)
  })

  it("ProviderError AUTH is not retryable", () => {
    const error = ProviderError("AUTH", "Bad key")
    expect(error.retryable).toBe(false)
  })

  it("ProviderError OVERLOADED is retryable", () => {
    const error = ProviderError("OVERLOADED", "At capacity")
    expect(error.retryable).toBe(true)
  })

  it("ProviderError MODEL_NOT_FOUND is not retryable", () => {
    const error = ProviderError("MODEL_NOT_FOUND", "Model does not exist")
    expect(error.retryable).toBe(false)
  })

  it("RequestError NETWORK is retryable", () => {
    const error = RequestError("NETWORK", "Connection failed")
    expect(error._tag).toBe("RequestError")
    expect(error.retryable).toBe(true)
  })

  it("RequestError TIMEOUT is retryable", () => {
    const error = RequestError("TIMEOUT", "Request timed out")
    expect(error.retryable).toBe(true)
  })

  it("RequestError ABORTED is not retryable", () => {
    const error = RequestError("ABORTED", "User cancelled")
    expect(error.retryable).toBe(false)
  })

  it("RequestError CONTEXT_LENGTH is not retryable", () => {
    const error = RequestError("CONTEXT_LENGTH", "Too long")
    expect(error.retryable).toBe(false)
  })

  it("HookError is not retryable", () => {
    const error = HookError("Hook failed")
    expect(error._tag).toBe("HookError")
    expect(error.code).toBe("HOOK_FAILED")
    expect(error.retryable).toBe(false)
  })
})

describe("fallback classification", () => {
  it("uses ConfigError fallback", () => {
    const error = toSdkError(new Error("something unknown"), "ConfigError")
    expect(error._tag).toBe("ConfigError")
    if (error._tag === "ConfigError") {
      expect(error.code).toBe("CONFIG_INVALID")
    }
  })

  it("uses HookError fallback", () => {
    const error = toSdkError(new Error("something unknown"), "HookError")
    expect(error._tag).toBe("HookError")
  })

  it("uses ProviderError fallback", () => {
    const error = toSdkError(new Error("something unknown"), "ProviderError")
    expect(error._tag).toBe("ProviderError")
    if (error._tag === "ProviderError") {
      expect(error.code).toBe("MODEL_NOT_FOUND")
    }
  })

  it("uses RequestError fallback by default", () => {
    const error = toSdkError(new Error("something unknown"))
    expect(error._tag).toBe("RequestError")
    if (error._tag === "RequestError") {
      expect(error.code).toBe("NETWORK")
    }
  })
})

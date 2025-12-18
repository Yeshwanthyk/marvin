import { describe, expect, it } from "bun:test"

import { colors } from "../src/utils/colors.js"
import { visibleWidth } from "../src/utils/text.js"

describe("@mu-agents/tui-solid", () => {
  it("exports core utils", () => {
    expect(typeof colors.bg).toBe("string")
    expect(visibleWidth("abc")).toBe(3)
  })
})


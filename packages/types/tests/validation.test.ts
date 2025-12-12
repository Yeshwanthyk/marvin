import { describe, it, expect } from "bun:test";
import { Type } from "@sinclair/typebox";
import { StrictObject, validate, TypeBoxValidationError } from "../src/index";

describe("@mu-agents/types", () => {
  it("StrictObject disallows additional properties", () => {
    const schema = StrictObject({ a: Type.String() });
    expect((schema as any).additionalProperties).toBe(false);
  });

  it("validate returns typed value when valid", () => {
    const schema = Type.Object({ a: Type.String() });
    const value = validate(schema, { a: "ok" });
    expect(value.a).toBe("ok");
  });

  it("validate throws a TypeBoxValidationError when invalid", () => {
    const schema = Type.Object({ a: Type.String() });
    expect(() => validate(schema, { a: 123 })).toThrow(TypeBoxValidationError);
  });
});


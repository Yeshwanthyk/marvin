import { Type } from '@sinclair/typebox';
import type { ObjectOptions, Static, TObject, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { ValueError } from '@sinclair/typebox/errors';

export type StringEnumValues = readonly [string, ...string[]];

type StrictObjectOptions = Omit<ObjectOptions, 'additionalProperties'>;

type SchemaRecord = Record<string, TSchema>;

/**
 * Enforces a closed object type (no `additionalProperties`) to keep schemas deterministic.
 */
export const StrictObject = <TProps extends SchemaRecord>(
  properties: TProps,
  options?: StrictObjectOptions
): TObject<TProps> =>
  Type.Object(properties, {
    additionalProperties: false,
    ...options,
  });

export const Nullable = <TS extends TSchema>(schema: TS, options?: object) =>
  Type.Union([schema, Type.Null()], options);

export const StringEnum = <TValues extends StringEnumValues>(
  values: TValues,
  options?: object
): TSchema => {
  const literals = values.map((value) => Type.Literal(value));
  if (literals.length === 1) {
    return literals[0];
  }

  return Type.Union(literals as unknown as [TSchema, TSchema, ...TSchema[]], options);
};

export type RuntimeValidator<T extends TSchema> = (data: unknown) => data is Static<T>;

export class TypeBoxValidationError extends Error {
  readonly schema: TSchema;
  readonly data: unknown;
  readonly issues: ValueError[];

  constructor(schema: TSchema, data: unknown, issues: Iterable<ValueError>, message?: string) {
    const normalizedIssues = Array.from(issues);
    const label = message ?? 'TypeBox schema validation failed';
    const issueSummary = normalizedIssues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('\n');
    super(issueSummary ? `${label}\n${issueSummary}` : label);
    this.schema = schema;
    this.data = data;
    this.issues = normalizedIssues;
  }
}

export const createValidator = <T extends TSchema>(schema: T): RuntimeValidator<T> => {
  return (data: unknown): data is Static<T> => Value.Check(schema, data);
};

export const assertValid: <T extends TSchema>(
  schema: T,
  data: unknown,
  message?: string
) => asserts data is Static<T> = (schema, data, message) => {
  const issues = Array.from(Value.Errors(schema, data));
  if (issues.length > 0) {
    throw new TypeBoxValidationError(schema, data, issues, message);
  }
};

export const validate = <T extends TSchema>(schema: T, data: unknown, message?: string): Static<T> => {
  assertValid(schema, data, message);
  return data;
};

/**
 * Zod → JSON Schema.
 *
 * §9 requires that the schema sent to the provider is *generated* from the Zod
 * schema, so the validator and the model's instructions can never drift. This
 * is hand-rolled rather than pulled from a package because we control every
 * schema in the catalog: it only has to cover the constructs we actually use,
 * and in exchange we get exact control over the shape, which is what makes the
 * Gemini narrowing in `schema-narrow.ts` tractable.
 *
 * If you add a Zod construct the catalog has not used before, extend this.
 * Throwing loudly on an unknown type is deliberate — a silently-dropped
 * constraint would show up as a mysterious model failure weeks later.
 */
import { z } from 'zod';
import type { JsonSchema } from '../providers/types';

type AnyZod = z.ZodTypeAny;

interface Def {
  typeName: string;
  [k: string]: unknown;
}

function def(schema: AnyZod): Def {
  return (schema as unknown as { _def: Def })._def;
}

export function toJsonSchema(schema: AnyZod): JsonSchema {
  const out = convert(schema);
  const description = schema.description;
  if (description && !out.description) out.description = description;
  return out;
}

function convert(schema: AnyZod): JsonSchema {
  const d = def(schema);

  switch (d.typeName) {
    case 'ZodString':
      return stringSchema(d);
    case 'ZodNumber':
      return numberSchema(d);
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodLiteral': {
      const value = d.value as string | number | boolean;
      return { type: typeof value === 'number' ? 'number' : typeof value, const: value, enum: [value] };
    }
    case 'ZodEnum':
      return { type: 'string', enum: [...(d.values as string[])] };
    case 'ZodNativeEnum':
      return { type: 'string', enum: Object.values(d.values as Record<string, string>) };
    case 'ZodArray':
      return arraySchema(d);
    case 'ZodTuple': {
      const items = (d.items as AnyZod[]).map(convert);
      return {
        type: 'array',
        items,
        minItems: items.length,
        maxItems: items.length,
      };
    }
    case 'ZodObject':
      return objectSchema(schema as z.ZodObject<z.ZodRawShape>);
    case 'ZodRecord':
      return { type: 'object', additionalProperties: convert(d.valueType as AnyZod) };
    case 'ZodUnion':
      return { anyOf: (d.options as AnyZod[]).map(convert) };
    case 'ZodDiscriminatedUnion':
      return { anyOf: [...(d.options as AnyZod[])].map(convert) };
    case 'ZodOptional':
    case 'ZodNullable':
      return convert(d.innerType as AnyZod);
    case 'ZodDefault': {
      const inner = convert(d.innerType as AnyZod);
      const value = (d.defaultValue as () => unknown)();
      return { ...inner, default: value };
    }
    case 'ZodEffects':
      return convert(d.schema as AnyZod);
    case 'ZodLazy':
      return convert((d.getter as () => AnyZod)());
    case 'ZodAny':
    case 'ZodUnknown':
      return {};
    default:
      throw new Error(
        `toJsonSchema: unsupported Zod type "${d.typeName}". Add a case for it rather than letting the constraint disappear.`,
      );
  }
}

function stringSchema(d: Def): JsonSchema {
  const out: JsonSchema = { type: 'string' };
  for (const c of (d.checks as { kind: string; value?: unknown; regex?: RegExp }[]) ?? []) {
    if (c.kind === 'min') out.minLength = c.value as number;
    else if (c.kind === 'max') out.maxLength = c.value as number;
    else if (c.kind === 'regex' && c.regex) out.pattern = c.regex.source;
    else if (c.kind === 'url') out.format = 'uri';
  }
  return out;
}

function numberSchema(d: Def): JsonSchema {
  const out: JsonSchema = { type: 'number' };
  for (const c of (d.checks as { kind: string; value?: unknown }[]) ?? []) {
    if (c.kind === 'min') out.minimum = c.value as number;
    else if (c.kind === 'max') out.maximum = c.value as number;
    else if (c.kind === 'int') out.type = 'integer';
  }
  return out;
}

function arraySchema(d: Def): JsonSchema {
  const out: JsonSchema = { type: 'array', items: convert(d.type as AnyZod) };
  const min = d.minLength as { value: number } | null;
  const max = d.maxLength as { value: number } | null;
  if (min) out.minItems = min.value;
  if (max) out.maxItems = max.value;
  return out;
}

function objectSchema(schema: z.ZodObject<z.ZodRawShape>): JsonSchema {
  const shape = schema.shape;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const key of Object.keys(shape)) {
    const field = shape[key];
    if (!field) continue;
    const sub = convert(field);
    const description = field.description;
    if (description) sub.description = description;
    properties[key] = sub;
    if (!isOptional(field)) required.push(key);
  }

  const out: JsonSchema = { type: 'object', properties };
  if (required.length) out.required = required;
  // Strict Zod objects reject unknown keys; say so in the schema too, so a
  // model that reads it does not invent fields we are about to reject.
  const unknownKeys = (def(schema) as { unknownKeys?: string }).unknownKeys;
  if (unknownKeys === 'strict') out.additionalProperties = false;
  return out;
}

function isOptional(schema: AnyZod): boolean {
  const t = def(schema).typeName;
  return t === 'ZodOptional' || t === 'ZodDefault' || schema.isOptional();
}

/**
 * The schema as it is sent to the model (§18).
 *
 * A tool's schema is re-sent on every turn, so every key in it is paid for
 * dozens of times per question. The Zod schema stays the authority and still
 * validates every call at the bus; what the model is sent drops the keys that
 * only a validator needs — length and size limits, numeric bounds, patterns,
 * `additionalProperties`, a `const` that repeats an `enum` — and keeps what
 * tells the model what to write: names, types, enums, required fields and
 * descriptions.
 *
 * Limits are left out for a second reason. Some services check a tool call
 * against this schema themselves and refuse the whole response when a string
 * runs a few characters over, which costs a turn and teaches the model
 * nothing. Our own bus is the one place a call is checked, and it answers
 * with the field named so the model can repair it.
 *
 * What is sent must also be a valid schema under the current draft, which the
 * stricter services enforce: a tuple written as an `items` array is not, so it
 * becomes a plain array of whatever its positions hold.
 */
const VALIDATOR_ONLY = new Set([
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'default',
  'additionalProperties',
]);

function tupleItems(positions: JsonSchema[]): JsonSchema {
  const slim = positions.map(minifySchema);
  const distinct = [...new Map(slim.map((s) => [JSON.stringify(s), s])).values()];
  if (distinct.length === 0) return {};
  return distinct.length === 1 && distinct[0] ? distinct[0] : { anyOf: distinct };
}

export function minifySchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (VALIDATOR_ONLY.has(key)) continue;
    if (key === 'const' && schema.enum) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, minifySchema(v)]),
      );
    } else if (key === 'items' && value && typeof value === 'object') {
      out.items = Array.isArray(value) ? tupleItems(value as JsonSchema[]) : minifySchema(value as JsonSchema);
    } else if ((key === 'anyOf' || key === 'oneOf') && Array.isArray(value)) {
      out[key] = (value as JsonSchema[]).map(minifySchema);
    } else {
      out[key] = value;
    }
  }
  return out;
}

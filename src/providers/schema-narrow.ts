/**
 * Gemini accepts a narrower JSON Schema subset than the others (§5.3).
 *
 * The differences are absorbed here so nothing above the adapter layer has to
 * know they exist. What Gemini's function declarations reject, in practice:
 *
 *   - `$ref` and any definition indirection
 *   - `oneOf` (and, historically, `anyOf` in nested positions)
 *   - `additionalProperties`
 *   - `const`
 *   - most `format` keywords, and several length/pattern constraints
 *   - tuple-style `items` arrays
 *
 * The union of thirteen board operations is the hard case: with `anyOf`
 * unavailable in a nested array item, the only workable shape is a permissive
 * object whose `op` field is an enum, with the per-op fields flattened
 * alongside and described in prose. That loses compile-time strictness at the
 * provider, but not at the tool bus — Zod still rejects a malformed op with a
 * message the model can act on, which is where the real enforcement lives.
 */
import type { JsonSchema } from './types';

const ALLOWED_FORMATS = new Set(['enum', 'date-time']);

export function narrowSchemaForGemini(schema: JsonSchema): JsonSchema {
  return narrow(schema, 0);
}

function narrow(schema: JsonSchema, depth: number): JsonSchema {
  if (depth > 8) return { type: 'object' };

  const out: JsonSchema = {};

  if (schema.description) out.description = schema.description;

  // A union of objects becomes one merged, permissive object. Keeping the
  // discriminator as an enum is the part that actually steers the model.
  const union = schema.anyOf ?? schema.oneOf;
  if (union && union.length) {
    return mergeUnion(union, depth, schema.description);
  }

  if (schema.enum) {
    out.type = 'string';
    out.enum = schema.enum.filter((v) => typeof v === 'string');
    if (!out.enum.length) delete out.enum;
    return out;
  }

  if (schema.const !== undefined) {
    out.type = typeof schema.const === 'number' ? 'number' : 'string';
    out.enum = [schema.const];
    return out;
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case 'object': {
      out.type = 'object';
      if (schema.properties) {
        const props: Record<string, JsonSchema> = {};
        for (const [k, v] of Object.entries(schema.properties)) {
          props[k] = narrow(v, depth + 1);
        }
        out.properties = props;
      }
      if (schema.required?.length) out.required = [...schema.required];
      // additionalProperties is rejected outright; strictness stays at the bus.
      return out;
    }

    case 'array': {
      out.type = 'array';
      const items = schema.items;
      if (Array.isArray(items)) {
        // A tuple becomes a plain array of the first element's type, with the
        // fixed length spelled out in the description instead.
        const first = items[0];
        out.items = first ? narrow(first, depth + 1) : { type: 'number' };
        out.description = [
          out.description,
          `Exactly ${items.length} values, in order.`,
        ]
          .filter(Boolean)
          .join(' ');
      } else if (items) {
        out.items = narrow(items, depth + 1);
      } else {
        out.items = { type: 'string' };
      }
      if (typeof schema.minItems === 'number') out.minItems = schema.minItems;
      if (typeof schema.maxItems === 'number') out.maxItems = schema.maxItems;
      return out;
    }

    case 'integer':
    case 'number':
      out.type = type;
      return out;

    case 'boolean':
      out.type = 'boolean';
      return out;

    default:
      out.type = 'string';
      if (schema.format && ALLOWED_FORMATS.has(schema.format)) out.format = schema.format;
      return out;
  }
}

/**
 * Flatten a union of object variants into one object.
 *
 * Every variant's properties are unioned; only properties every variant
 * requires stay required. The discriminator (a single-value enum present in
 * all variants) is rebuilt as a full enum, which is what tells the model which
 * shapes exist at all.
 */
function mergeUnion(variants: JsonSchema[], depth: number, description?: string): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const requiredCounts = new Map<string, number>();
  const discriminators = new Map<string, Set<string>>();
  let objectVariants = 0;

  for (const variant of variants) {
    if ((Array.isArray(variant.type) ? variant.type[0] : variant.type) !== 'object') {
      continue;
    }
    objectVariants += 1;

    for (const [key, value] of Object.entries(variant.properties ?? {})) {
      const singleEnum =
        value.enum?.length === 1 && typeof value.enum[0] === 'string' ? value.enum[0] : null;
      if (singleEnum) {
        const set = discriminators.get(key) ?? new Set<string>();
        set.add(singleEnum);
        discriminators.set(key, set);
      }
      if (!properties[key]) properties[key] = narrow(value, depth + 1);
    }

    for (const key of variant.required ?? []) {
      requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
    }
  }

  if (!objectVariants) {
    // Not a union of objects — fall back to the first variant we can express.
    const first = variants[0];
    return first ? narrow(first, depth + 1) : { type: 'string' };
  }

  for (const [key, values] of discriminators) {
    if (values.size > 1) {
      properties[key] = {
        type: 'string',
        enum: [...values],
        description: `Which kind this is. Every other field is determined by this choice.`,
      };
    }
  }

  const required = [...requiredCounts.entries()]
    .filter(([, n]) => n === objectVariants)
    .map(([k]) => k);

  const out: JsonSchema = { type: 'object', properties };
  if (required.length) out.required = required;
  if (description) out.description = description;
  return out;
}

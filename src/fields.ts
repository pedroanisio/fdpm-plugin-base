// ---------------------------------------------------------------------------
// fields -- typed constructors for FieldDef, one per shape the profile uses.
//
// Every constructor emits the annotations its shape owes the schema-design
// standard: a numeric field cannot be built without a unit, a temporal one
// without timezone and precision, a reference without its foreign-key target
// and lifecycle ownership, a list without cardinality and ordering. The gate
// in tests/schema-rules.test.ts checks the result; these make it hard to fail.
// ---------------------------------------------------------------------------

import type { FieldDefT, FieldValidation } from "@fdpm/cli";
import {
  annotate,
  type FieldAnnotations,
  type Ordering,
  type Relationship,
} from "./annotations.js";
import { BCP47_PATTERN, EDTF_PATTERN, INSTANT_PATTERN } from "./vocabulary.js";

interface Common {
  /** Whether the field must be present. Defaults to false. */
  required?: boolean;
  /** Extra annotations merged over the ones the shape implies. */
  ann?: FieldAnnotations;
}

function build(field: FieldDefT): FieldDefT {
  return field;
}

/** Free text with an enforced maximum length. */
export function text(
  name: string,
  prose: string,
  maxLength: number,
  opts: Common & { pattern?: RegExp } = {},
): FieldDefT {
  const validations: FieldValidation[] = [{ kind: "max_length", value: maxLength, level: "error" }];
  if (opts.pattern !== undefined) {
    validations.push({ kind: "pattern", value: opts.pattern.source, level: "error" });
  }
  return build({
    name,
    kind: "string",
    required: opts.required ?? false,
    validations,
    description: annotate(prose, opts.ann ?? {}),
  });
}

/** Long-form prose with an enforced maximum length. */
export function longText(
  name: string,
  prose: string,
  maxLength: number,
  opts: Common = {},
): FieldDefT {
  return build({
    name,
    kind: "text",
    required: opts.required ?? false,
    validations: [{ kind: "max_length", value: maxLength, level: "error" }],
    description: annotate(prose, opts.ann ?? {}),
  });
}

/** Whole number carrying a declared unit. */
export function integer(
  name: string,
  prose: string,
  unit: string,
  opts: Common & { min?: number; max?: number } = {},
): FieldDefT {
  return build({
    name,
    kind: "integer",
    required: opts.required ?? false,
    validations: bounds(opts.min, opts.max),
    description: annotate(prose, { unit, ...opts.ann }),
  });
}

/** Real number carrying a declared unit. */
export function decimal(
  name: string,
  prose: string,
  unit: string,
  opts: Common & { min?: number; max?: number } = {},
): FieldDefT {
  return build({
    name,
    kind: "number",
    required: opts.required ?? false,
    validations: bounds(opts.min, opts.max),
    description: annotate(prose, { unit, ...opts.ann }),
  });
}

function bounds(min?: number, max?: number): FieldValidation[] {
  const out: FieldValidation[] = [];
  if (min !== undefined) out.push({ kind: "min", value: min, level: "error" });
  if (max !== undefined) out.push({ kind: "max", value: max, level: "error" });
  return out;
}

/** Boolean with a declared default, so an absent value has one meaning. */
export function flag(
  name: string,
  prose: string,
  defaultValue: boolean,
  opts: Common = {},
): FieldDefT {
  return build({
    name,
    kind: "boolean",
    required: opts.required ?? false,
    validations: [],
    default: defaultValue,
    description: annotate(prose, opts.ann ?? {}),
  });
}

/** Closed enumeration. */
export function choice(
  name: string,
  prose: string,
  values: readonly string[],
  opts: Common & { default?: string } = {},
): FieldDefT {
  const field: FieldDefT = {
    name,
    kind: "enum",
    required: opts.required ?? false,
    enum_values: [...values],
    validations: [],
    description: annotate(prose, opts.ann ?? {}),
  };
  return build(opts.default === undefined ? field : { ...field, default: opts.default });
}

/**
 * Enumeration pinned to a single value.
 *
 * This is how a literal is expressed in a meta-model that has no literal
 * type: it is what makes an ISBN on an expression unrepresentable rather
 * than merely discouraged.
 */
export function pinned(name: string, prose: string, value: string): FieldDefT {
  return build({
    name,
    kind: "enum",
    required: true,
    enum_values: [value],
    validations: [],
    description: annotate(prose, {}),
  });
}

/** RFC 3339 instant, normalized to UTC. */
export function instant(name: string, prose: string, opts: Common = {}): FieldDefT {
  return build({
    name,
    kind: "datetime",
    required: opts.required ?? false,
    validations: [{ kind: "pattern", value: INSTANT_PATTERN.source, level: "error" }],
    description: annotate(prose, { timezone: "UTC", precision: "seconds", ...opts.ann }),
  });
}

/**
 * EDTF level-0 partial date: a year, a year-month, or a full date.
 *
 * Publication dates are routinely known only to the year, and widening them
 * to a full instant would invent precision the source never had.
 */
export function partialDate(name: string, prose: string, opts: Common = {}): FieldDefT {
  return build({
    name,
    kind: "string",
    required: opts.required ?? false,
    validations: [{ kind: "pattern", value: EDTF_PATTERN.source, level: "error" }],
    description: annotate(prose, { precision: "edtf", timezone: "none", ...opts.ann }),
  });
}

/** BCP 47 language tag. */
export function locale(name: string, prose: string, opts: Common = {}): FieldDefT {
  return text(name, prose, 35, { ...opts, pattern: BCP47_PATTERN });
}

/** Absolute IRI. */
export function iri(name: string, prose: string, opts: Common = {}): FieldDefT {
  return text(name, prose, 2048, { ...opts, pattern: /^[a-z][a-z0-9+.-]*:\S+$/ });
}

/**
 * Single-valued reference to another primitive in this workbook.
 *
 * Composition is a reference; association is a relation edge. A reference
 * therefore always declares which of the two it is, and what it points at.
 */
export function ref(
  name: string,
  prose: string,
  targetTypeId: string,
  relationship: Relationship,
  opts: Common = {},
): FieldDefT {
  return build({
    name,
    kind: "id-ref",
    required: opts.required ?? false,
    ref_type_id: targetTypeId,
    validations: [],
    description: annotate(prose, {
      fk: `${targetTypeId}.id`,
      relationship,
      ...opts.ann,
    }),
  });
}

/** Homogeneous list with declared cardinality and ordering. */
export function list(
  name: string,
  prose: string,
  item: FieldDefT,
  ordering: Ordering,
  maxItems: number,
  opts: Common & { minItems?: number } = {},
): FieldDefT {
  const validations: FieldValidation[] = [{ kind: "max_items", value: maxItems, level: "error" }];
  if (opts.minItems !== undefined) {
    validations.push({ kind: "min_items", value: opts.minItems, level: "error" });
  }
  return build({
    name,
    kind: "list",
    required: opts.required ?? false,
    item_field: item,
    validations,
    description: annotate(prose, { ordering, ...opts.ann }),
  });
}

/** Item definition for a list of scalars. */
export function item(kind: "string" | "integer" | "number", maxLength?: number): FieldDefT {
  return {
    name: "value",
    kind,
    required: true,
    validations:
      maxLength === undefined ? [] : [{ kind: "max_length", value: maxLength, level: "error" }],
    description: annotate("One entry of the containing list.", {}),
  };
}

/** Item definition for a list of structs. */
export function structItem(structId: string): FieldDefT {
  return {
    name: "value",
    kind: "struct",
    required: true,
    struct_id: structId,
    validations: [],
    description: annotate("One entry of the containing list.", {}),
  };
}

/** Embedded struct, defined once at profile level and referenced here. */
export function struct(
  name: string,
  prose: string,
  structId: string,
  opts: Common = {},
): FieldDefT {
  return build({
    name,
    kind: "struct",
    required: opts.required ?? false,
    struct_id: structId,
    validations: [],
    description: annotate(prose, opts.ann ?? {}),
  });
}

/**
 * Deliberate escape hatch for content this profile does not model.
 *
 * The only untyped kind in the meta-model, and legitimate only when the
 * opacity is the point: an unrecognized namespace is data this deployment
 * does not model yet, not an error.
 */
export function extensionPoint(name: string, prose: string, opts: Common = {}): FieldDefT {
  return build({
    name,
    kind: "json",
    required: opts.required ?? false,
    validations: [],
    description: annotate(prose, { extensionPoint: true, ...opts.ann }),
  });
}

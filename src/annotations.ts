// ---------------------------------------------------------------------------
// annotations -- schema-design annotations carried inside FieldDef.description.
//
// The FDPM meta-model is a strict Zod object: a FieldDef rejects unknown keys,
// so `x-unit`, `x-fk` and the rest of the standard's annotation vocabulary have
// nowhere structural to live. They ride inside `description` in a bracketed
// form that parses back losslessly, which keeps the unit, the foreign-key
// target and the sensitivity class recoverable from the profile alone.
// ---------------------------------------------------------------------------

/** Raised when a description carries an annotation the vocabulary does not define. */
export class AnnotationError extends Error {
  constructor(
    message: string,
    readonly key: string,
  ) {
    super(message);
    this.name = "AnnotationError";
  }
}

/** Ordering semantics of a list field. */
export type Ordering = "significant" | "insignificant";

/** Lifecycle ownership between the referring and the referenced type. */
export type Relationship = "composition" | "aggregation" | "association";

/** Data classification of a field carrying regulated content. */
export type Sensitivity = "pii" | "phi" | "credential" | "financial";

/** How localized display text is modeled. */
export type Localization = "locale-map" | "single-locale" | "locale-per-entity";

/** Whether a stored value is canonical, cached, or an override. */
export type Derivation = "source-of-truth" | "derived-cached" | "override-if-present";

/** Topology permitted on a reference graph. */
export type GraphConstraint = "DAG" | "allow-cycles";

/** Annotations a field or type may declare. Every key is optional and absent means unstated. */
export interface FieldAnnotations {
  /** Unit of a numeric value, e.g. `seconds`, `bytes`, `bitsPerSecond`. */
  unit?: string;
  /** Timezone handling of a temporal value, e.g. `UTC`. */
  timezone?: string;
  /** Temporal precision, e.g. `seconds`, `day`, `edtf`. */
  precision?: string;
  /** Whether list order carries meaning. */
  ordering?: Ordering;
  /** Foreign-key target as `TypeId.field`. */
  fk?: string;
  /** Set when the foreign key resolves outside this profile. */
  fkExternal?: boolean;
  /** Lifecycle ownership implied by the reference. */
  relationship?: Relationship;
  /** Data classification of regulated content. */
  sensitivity?: Sensitivity;
  /** Set when the value is written once and never modified. */
  immutable?: boolean;
  /** Localization strategy of a display field. */
  localization?: Localization;
  /** Set when the field is a deliberate, opaque escape hatch. */
  extensionPoint?: boolean;
  /** Whether the stored value is canonical, cached, or an override. */
  derivation?: Derivation;
  /** Source the value derives from, as `TypeId.field`. */
  derivedFrom?: string;
  /** Topology permitted on the graph this reference participates in. */
  graphConstraint?: GraphConstraint;
  /** Maximum traversal depth on a graph that permits cycles. */
  maxDepth?: number;
  /** Recorded rationale for a rule this field does not satisfy. */
  waiver?: string;
  /** Set once the field is scheduled for removal. */
  deprecated?: boolean;
  /** Profile version in which deprecation began. */
  deprecatedSince?: string;
  /** Replacement field, as `TypeId.field`. */
  replacedBy?: string;
  /** Profile version after which removal is permitted. */
  sunset?: string;
}

type Kind = "string" | "boolean" | "integer" | Readonly<string[]>;

/**
 * Annotation vocabulary: the wire key, the property it maps to, and its value
 * domain. Declaration order fixes the encoding order, so one annotation set
 * always encodes to one string.
 */
const VOCABULARY = [
  ["x-unit", "unit", "string"],
  ["x-timezone", "timezone", "string"],
  ["x-precision", "precision", "string"],
  ["x-ordering", "ordering", ["significant", "insignificant"]],
  ["x-fk", "fk", "string"],
  ["x-fk-external", "fkExternal", "boolean"],
  ["x-relationship", "relationship", ["composition", "aggregation", "association"]],
  ["x-sensitivity", "sensitivity", ["pii", "phi", "credential", "financial"]],
  ["x-immutable", "immutable", "boolean"],
  ["x-localization", "localization", ["locale-map", "single-locale", "locale-per-entity"]],
  ["x-extension-point", "extensionPoint", "boolean"],
  ["x-derivation", "derivation", ["source-of-truth", "derived-cached", "override-if-present"]],
  ["x-derived-from", "derivedFrom", "string"],
  ["x-graph-constraint", "graphConstraint", ["DAG", "allow-cycles"]],
  ["x-max-depth", "maxDepth", "integer"],
  ["x-waiver", "waiver", "string"],
  ["x-deprecated", "deprecated", "boolean"],
  ["x-deprecated-since", "deprecatedSince", "string"],
  ["x-replaced-by", "replacedBy", "string"],
  ["x-sunset", "sunset", "string"],
] as const satisfies ReadonlyArray<readonly [string, keyof FieldAnnotations, Kind]>;

const BY_WIRE_KEY = new Map<string, (typeof VOCABULARY)[number]>(
  VOCABULARY.map((entry) => [entry[0], entry]),
);

const ANNOTATION = /\[(x-[a-z-]+):([^\]]*)\]/g;

/**
 * Render an annotation set as bracketed text, in vocabulary order.
 *
 * @param annotations - Annotations to encode; absent keys are omitted.
 * @returns Space-separated annotation text, empty when nothing is set.
 */
export function encodeAnnotations(annotations: FieldAnnotations): string {
  const parts: string[] = [];
  for (const [wire, property] of VOCABULARY) {
    const value = annotations[property];
    if (value === undefined) continue;
    parts.push(`[${wire}: ${String(value)}]`);
  }
  return parts.join(" ");
}

/**
 * Recover the annotation set a description carries.
 *
 * @param description - Field or type description, with or without annotations.
 * @returns Every annotation found; an empty object when the text carries none.
 * @throws {@link AnnotationError} If a key is outside the vocabulary or a value
 * is outside its declared domain.
 */
export function parseAnnotations(description: string): FieldAnnotations {
  const out: Record<string, unknown> = {};
  for (const match of description.matchAll(ANNOTATION)) {
    const wire = match[1]!;
    const raw = match[2]!.trim();
    const entry = BY_WIRE_KEY.get(wire);
    if (entry === undefined) {
      throw new AnnotationError(`unknown annotation "${wire}"`, wire);
    }
    if (raw === "") {
      throw new AnnotationError(`annotation "${wire}" has an empty value`, wire);
    }
    const [, property, kind] = entry;
    out[property] = coerce(wire, raw, kind);
  }
  return out as FieldAnnotations;
}

/** Convert one raw annotation value to its declared type, or reject it. */
function coerce(wire: string, raw: string, kind: Kind): string | boolean | number {
  if (kind === "string") return raw;
  if (kind === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new AnnotationError(`annotation "${wire}" expects true or false, got "${raw}"`, wire);
  }
  if (kind === "integer") {
    if (!/^-?\d+$/.test(raw)) {
      throw new AnnotationError(`annotation "${wire}" expects an integer, got "${raw}"`, wire);
    }
    return Number.parseInt(raw, 10);
  }
  if (!kind.includes(raw)) {
    throw new AnnotationError(
      `annotation "${wire}" expects one of ${kind.join(", ")}, got "${raw}"`,
      wire,
    );
  }
  return raw;
}

/**
 * Join prose and annotations into the description a FieldDef carries.
 *
 * @param prose - Human-readable explanation of the field.
 * @param annotations - Annotations to append.
 * @returns The description, with annotations appended when any are set.
 *
 * @example
 * annotate("Runtime of the cut.", { unit: "seconds" });
 * // => "Runtime of the cut. [x-unit: seconds]"
 */
export function annotate(prose: string, annotations: FieldAnnotations = {}): string {
  const encoded = encodeAnnotations(annotations);
  return encoded === "" ? prose : `${prose} ${encoded}`;
}

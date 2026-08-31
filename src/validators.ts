// ---------------------------------------------------------------------------
// validators -- semantic checks the FDPM meta-model cannot express.
//
// Field shape and CEL cover per-field bounds and single-instance invariants.
// What is left needs code: per-scheme identifier syntax, agreement between an
// identifier's layer and its referent's, the confidence rules attached to an
// epistemic status, and graph acyclicity. Each check parses its input before
// judging it and reports a finding rather than throwing, because the host's
// pipeline treats a raised validator as a plugin defect and quarantines it.
// ---------------------------------------------------------------------------

import type { PrimitiveInstance, RelationInstance, ValidationFinding } from "@fdpm/cli";
import type { ValidatorContext, ValidatorFn, ValidatorRegistration } from "./host-contract.js";
import {
  ACYCLIC_PREDICATES,
  ASSERTION_KINDS,
  BCP47_PATTERN,
  IDENTIFIER_LAYERS,
  INSTANT_PATTERN,
  OTHER_SCHEME,
  OTHER_SCHEME_NAME_PATTERN,
  RELATION_PREDICATES,
  schemeByName,
} from "./vocabulary.js";

/** Rule id reported by {@link validateIdentifier}. */
export const RULE_IDENTIFIER = "media:val:identifier-scheme-and-layer";

/** Rule id reported by {@link validateAssertion}. */
export const RULE_ASSERTION = "media:val:assertion-confidence";

/** Rule id reported by {@link validateLocalizedText}. */
export const RULE_LOCALIZED = "media:val:localized-text-primary-locale";

/** Rule id reported by {@link validateAcyclic}. */
export const RULE_ACYCLIC = "media:val:acyclic-predicate";

/** Primitive type whose instances {@link validateIdentifier} judges. */
export const IDENTIFIER_TYPE_ID = "media:Identifier";

function finding(
  ruleId: string,
  targetId: string,
  fieldPath: string | null,
  message: string,
  evidence?: Record<string, unknown>,
): ValidationFinding {
  return evidence === undefined
    ? { level: "error", rule_id: ruleId, target_id: targetId, field_path: fieldPath, message }
    : {
        level: "error",
        rule_id: ruleId,
        target_id: targetId,
        field_path: fieldPath,
        message,
        evidence,
      };
}

/** Read a field as a string, or `undefined` when absent or of another type. */
function str(values: Record<string, unknown>, name: string): string | undefined {
  const raw = values[name];
  return typeof raw === "string" ? raw : undefined;
}

// -- identifiers ----------------------------------------------------------

/**
 * Check an identifier's syntax and its agreement with the layer it addresses.
 *
 * An ISRC names a recording and an ISBN names an edition. Filing either
 * against the wrong layer is the error this rejects, on three counts: the
 * scheme must be known, its syntax must accept the value, and the layer the
 * scheme addresses must match both the declared layer and the referent's own.
 *
 * @param instance - The `media:Identifier` primitive being written.
 * @param context - Workbook slice used to resolve the referent.
 * @returns Findings for every violation; empty when the identifier is sound.
 */
export function validateIdentifier(
  instance: PrimitiveInstance | RelationInstance,
  context?: ValidatorContext,
): ValidationFinding[] {
  const values = instance.field_values;
  const at = (path: string | null, message: string, evidence?: Record<string, unknown>) =>
    finding(RULE_IDENTIFIER, instance.id, path, message, evidence);

  const schemeToken = str(values, "scheme");
  if (schemeToken === undefined) {
    return [at("field_values.scheme", "scheme is required and must be a string")];
  }

  const value = str(values, "value");
  if (value === undefined) {
    return [at("field_values.value", "value is required and must be a string")];
  }

  const declaredLayer = str(values, "addressesLayer");
  if (
    declaredLayer === undefined ||
    !(IDENTIFIER_LAYERS as readonly string[]).includes(declaredLayer)
  ) {
    return [
      at(
        "field_values.addressesLayer",
        `addressesLayer must be one of ${IDENTIFIER_LAYERS.join(", ")}`,
      ),
    ];
  }

  if (schemeToken === OTHER_SCHEME) {
    const schemeName = str(values, "schemeName");
    if (schemeName === undefined || !OTHER_SCHEME_NAME_PATTERN.test(schemeName)) {
      return [
        at(
          "field_values.schemeName",
          'scheme "other" requires a namespaced schemeName such as "vendor:asin"',
        ),
      ];
    }
    return referentFindings(instance, values, declaredLayer, context, at);
  }

  const scheme = schemeByName(schemeToken);
  if (scheme === undefined) {
    return [
      at("field_values.scheme", `unknown identifier scheme "${schemeToken}"`, {
        scheme: schemeToken,
      }),
    ];
  }

  const findings: ValidationFinding[] = [];
  if (!scheme.pattern.test(value)) {
    findings.push(
      at("field_values.value", `value does not match ${scheme.label} syntax`, {
        pattern: scheme.pattern.source,
      }),
    );
  }

  // `unspecified` means the registry declares no layer -- a DOI may name a
  // work, a version or a dataset -- so the check stands down rather than
  // guessing one.
  if (scheme.layer !== "unspecified" && scheme.layer !== declaredLayer) {
    findings.push(
      at(
        "field_values.addressesLayer",
        `${scheme.label} addresses the ${scheme.layer} layer, not ${declaredLayer}`,
        { schemeLayer: scheme.layer, declaredLayer },
      ),
    );
  }

  return [...findings, ...referentFindings(instance, values, declaredLayer, context, at)];
}

/** Check that the referent exists and sits at the layer the identifier claims. */
function referentFindings(
  instance: PrimitiveInstance | RelationInstance,
  values: Record<string, unknown>,
  declaredLayer: string,
  context: ValidatorContext | undefined,
  at: (
    path: string | null,
    message: string,
    evidence?: Record<string, unknown>,
  ) => ValidationFinding,
): ValidationFinding[] {
  const referentId = str(values, "identifiesId");
  if (referentId === undefined) {
    return [at("field_values.identifiesId", "identifiesId is required and must be a string")];
  }

  // The referent lives in the workbook, so without it the layer check cannot
  // run. Reporting a clean write for an unchecked one would be worse than
  // reporting that the check could not run.
  const primitives = context?.workbook?.primitives;
  if (primitives === undefined) {
    return [
      at(
        "field_values.identifiesId",
        "cannot verify the referent's layer: the workbook slice was not supplied to the validator",
      ),
    ];
  }

  const referent = primitives[referentId];
  if (referent === undefined) {
    return [
      at("field_values.identifiesId", `identifiesId names no primitive in this workbook`, {
        identifiesId: referentId,
      }),
    ];
  }

  // `agent` and `unspecified` are not FRBR layers, so a referent carries no
  // `layer` field to compare against.
  const referentLayer = str(referent.field_values, "layer");
  if (referentLayer === undefined || declaredLayer === "agent" || declaredLayer === "unspecified") {
    return [];
  }
  if (referentLayer !== declaredLayer) {
    return [
      at(
        "field_values.identifiesId",
        `identifier addresses the ${declaredLayer} layer but ${referentId} sits at the ${referentLayer} layer`,
        { declaredLayer, referentLayer },
      ),
    ];
  }
  return [];
}

// -- assertions -----------------------------------------------------------

/**
 * Check that an asserted edge carries confidence consistent with its status.
 *
 * An inference without a confidence is unusable and a fact with one is a
 * category error; a self-directed edge is neither.
 *
 * @param instance - The relation being written.
 * @returns Findings for every violation; empty when the assertion is sound.
 */
export function validateAssertion(
  instance: PrimitiveInstance | RelationInstance,
): ValidationFinding[] {
  const values = instance.field_values;
  const at = (path: string | null, message: string) =>
    finding(RULE_ASSERTION, instance.id, path, message);
  const findings: ValidationFinding[] = [];

  const kind = str(values, "assertionKind");
  if (kind === undefined || !(ASSERTION_KINDS as readonly string[]).includes(kind)) {
    return [
      at(
        "field_values.assertionKind",
        `assertionKind must be one of ${ASSERTION_KINDS.join(", ")}`,
      ),
    ];
  }

  const rawConfidence = values["confidence"];
  const hasConfidence = rawConfidence !== undefined && rawConfidence !== null;
  if (hasConfidence && typeof rawConfidence !== "number") {
    findings.push(at("field_values.confidence", "confidence must be a number in [0, 1]"));
  } else if (hasConfidence && (rawConfidence < 0 || rawConfidence > 1)) {
    findings.push(at("field_values.confidence", `confidence ${rawConfidence} lies outside [0, 1]`));
  }

  if (kind === "inference" && !hasConfidence) {
    findings.push(at("field_values.confidence", "an inference must carry a confidence"));
  }
  if (kind === "fact" && hasConfidence) {
    findings.push(
      at(
        "field_values.confidence",
        "a fact is externally verifiable and must not carry confidence",
      ),
    );
  }

  const assertedAt = str(values, "assertedAt");
  if (assertedAt !== undefined && !INSTANT_PATTERN.test(assertedAt)) {
    findings.push(
      at("field_values.assertedAt", "assertedAt must be an RFC 3339 instant normalized to UTC"),
    );
  }

  if ("source_id" in instance && instance.source_id === instance.target_id) {
    findings.push(finding(RULE_ASSERTION, instance.id, null, "an edge must not point at itself"));
  }

  return findings;
}

// -- localization ---------------------------------------------------------

/** Localized value as stored: a primary locale plus one entry per translation. */
interface LocalizedTextShape {
  primaryLocale: string;
  values: { locale: string; text: string }[];
}

/** Parse a localized-text value, returning `null` when it is not one. */
function asLocalizedText(raw: unknown): LocalizedTextShape | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate["primaryLocale"] !== "string") return null;
  if (!Array.isArray(candidate["values"])) return null;
  const entries: { locale: string; text: string }[] = [];
  for (const entry of candidate["values"]) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row["locale"] !== "string" || typeof row["text"] !== "string") return null;
    entries.push({ locale: row["locale"], text: row["text"] });
  }
  return { primaryLocale: candidate["primaryLocale"] as string, values: entries };
}

/**
 * Check every localized field for a resolvable primary locale.
 *
 * The primary locale names the authoritative entry, so a value whose primary
 * locale has no entry leaves consumers guessing the fallback.
 *
 * @param instance - The primitive being written.
 * @returns Findings for every localized field that cannot resolve; empty otherwise.
 */
export function validateLocalizedText(
  instance: PrimitiveInstance | RelationInstance,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const [name, raw] of Object.entries(instance.field_values)) {
    const text = asLocalizedText(raw);
    if (text === null) continue;
    const path = `field_values.${name}`;
    const at = (message: string) => finding(RULE_LOCALIZED, instance.id, path, message);

    if (text.values.length === 0) {
      findings.push(at("a localized value must carry at least one locale entry"));
      continue;
    }
    if (!BCP47_PATTERN.test(text.primaryLocale)) {
      findings.push(at(`primaryLocale "${text.primaryLocale}" is not a BCP 47 language tag`));
      continue;
    }
    const malformed = text.values.map((v) => v.locale).filter((l) => !BCP47_PATTERN.test(l));
    if (malformed.length > 0) {
      findings.push(at(`locale tags are not BCP 47: ${malformed.join(", ")}`));
      continue;
    }
    if (!text.values.some((v) => v.locale === text.primaryLocale)) {
      findings.push(
        at(`primaryLocale "${text.primaryLocale}" has no entry among the localized values`),
      );
    }
  }
  return findings;
}

// -- graph topology -------------------------------------------------------

/**
 * Find one cycle among directed edges, if any exists.
 *
 * @param edges - Directed edges as `[from, to]` pairs.
 * @returns The nodes of one cycle, first node repeated last, or `null` when the graph is acyclic.
 */
export function findCycle(edges: readonly (readonly [string, string])[]): string[] | null {
  const outgoing = new Map<string, string[]>();
  for (const [from, to] of edges) {
    const list = outgoing.get(from) ?? [];
    list.push(to);
    outgoing.set(from, list);
  }

  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const stack: string[] = [];

  // Iterative depth-first search: a workbook's edge count is unbounded, and a
  // recursive walk would trade a cycle report for a stack overflow.
  const visit = (root: string): string[] | null => {
    const frames: { node: string; index: number }[] = [{ node: root, index: 0 }];
    state.set(root, VISITING);
    stack.push(root);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const neighbours = outgoing.get(frame.node) ?? [];
      if (frame.index >= neighbours.length) {
        state.set(frame.node, DONE);
        stack.pop();
        frames.pop();
        continue;
      }
      const next = neighbours[frame.index]!;
      frame.index += 1;
      const seen = state.get(next);
      if (seen === VISITING) {
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (seen === DONE) continue;
      state.set(next, VISITING);
      stack.push(next);
      frames.push({ node: next, index: 0 });
    }
    return null;
  };

  for (const node of outgoing.keys()) {
    if (state.get(node) !== undefined) continue;
    const cycle = visit(node);
    if (cycle !== null) return cycle;
  }
  return null;
}

/**
 * Relation type id carrying one predicate.
 *
 * The profile declares one relation type per predicate so that the type id is
 * the discriminator, and this function is the single definition of that
 * naming. Deriving the pair rather than registering it keeps the validator
 * free of load-order state: it answers the same way whether or not the
 * profile module has been imported.
 *
 * @param predicate - Predicate token from `RELATION_PREDICATES`.
 * @returns The relation type id that carries it.
 */
export function relationTypeIdFor(predicate: string): string {
  return `media:${predicate.charAt(0).toUpperCase()}${predicate.slice(1)}`;
}

const PREDICATE_BY_RELATION_TYPE: ReadonlyMap<string, string> = new Map(
  RELATION_PREDICATES.map((p) => [relationTypeIdFor(p), p as string]),
);

/**
 * Recover the predicate a relation type carries.
 *
 * @param typeId - Relation type id.
 * @returns The predicate, or `undefined` when the type is not one of this profile's.
 */
export function predicateOfRelationType(typeId: string): string | undefined {
  return PREDICATE_BY_RELATION_TYPE.get(typeId);
}

/**
 * Reject an edge that closes a cycle on a predicate declared acyclic.
 *
 * @param instance - The relation being written.
 * @param context - Workbook slice supplying the edges already stored.
 * @returns A single finding when the write closes a cycle; empty otherwise.
 */
export function validateAcyclic(
  instance: PrimitiveInstance | RelationInstance,
  context?: ValidatorContext,
): ValidationFinding[] {
  if (!("source_id" in instance)) return [];

  const predicate =
    str(instance.field_values, "predicate") ?? predicateOfRelationType(instance.type_id);
  if (predicate === undefined || !(ACYCLIC_PREDICATES as readonly string[]).includes(predicate)) {
    return [];
  }

  if (context === undefined) {
    return [
      finding(
        RULE_ACYCLIC,
        instance.id,
        null,
        `cannot verify acyclicity of "${predicate}": no relation set was supplied to the validator`,
      ),
    ];
  }

  const sameType = context.relations.filter((r) => r.type_id === instance.type_id);
  const edges: [string, string][] = sameType.map((r) => [r.source_id, r.target_id]);
  if (!sameType.some((r) => r.id === instance.id)) {
    edges.push([instance.source_id, instance.target_id]);
  }

  const cycle = findCycle(edges);
  if (cycle === null) return [];
  return [
    finding(
      RULE_ACYCLIC,
      instance.id,
      null,
      `"${predicate}" must stay acyclic; this edge closes the cycle ${cycle.join(" -> ")}`,
      { cycle },
    ),
  ];
}

/** Validator registrations, paired with the type each one judges. */
export interface MediaValidator extends ValidatorRegistration {
  rule_id: string;
}

/**
 * Build the validator registrations for one set of types.
 *
 * @param resourceTypeIds - Primitive types carrying localized fields.
 * @param relationTypeIds - Relation types carrying assertion metadata.
 * @returns One registration per (type, rule) pair the host should install.
 */
export function buildValidators(
  resourceTypeIds: readonly string[],
  relationTypeIds: readonly string[],
): MediaValidator[] {
  const out: MediaValidator[] = [
    { type_id: IDENTIFIER_TYPE_ID, rule_id: RULE_IDENTIFIER, fn: contextual(validateIdentifier) },
  ];
  for (const typeId of resourceTypeIds) {
    out.push({ type_id: typeId, rule_id: RULE_LOCALIZED, fn: standalone(validateLocalizedText) });
  }
  for (const typeId of relationTypeIds) {
    out.push({ type_id: typeId, rule_id: RULE_ASSERTION, fn: standalone(validateAssertion) });
    out.push({ type_id: typeId, rule_id: RULE_ACYCLIC, fn: contextual(validateAcyclic) });
  }
  return out;
}

/**
 * Adapt a context-taking check to the host's four-argument validator contract.
 *
 * The host calls `(instance, type, profile, context)`. A check that declares
 * `(instance, context)` would receive the resolved type definition as its
 * context and conclude, on every write, that the workbook was not supplied.
 *
 * @param check - Check taking the instance and the workbook slice.
 * @returns A validator function positioned as the host calls it.
 */
export function contextual(
  check: (
    instance: PrimitiveInstance | RelationInstance,
    context?: ValidatorContext,
  ) => ValidationFinding[],
): ValidatorFn {
  return (instance, _type, _profile, context) => check(instance, context);
}

/**
 * Adapt a check that reads only the instance to the host's validator contract.
 *
 * @param check - Check taking the instance alone.
 * @returns A validator function positioned as the host calls it.
 */
export function standalone(
  check: (instance: PrimitiveInstance | RelationInstance) => ValidationFinding[],
): ValidatorFn {
  return (instance) => check(instance);
}

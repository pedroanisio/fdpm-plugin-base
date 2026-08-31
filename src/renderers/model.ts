// ---------------------------------------------------------------------------
// model -- the shape a renderer walks, derived from the profile itself.
//
// The FRBR spine is not a list kept here. Every reference field in the profile
// already declares its target and its lifecycle ownership as `[x-fk: ...]` and
// `[x-relationship: ...]` inside the field description, so the spine is read
// back out of the profile at render time. A type added to `primitives.ts`
// therefore nests correctly with no second edit in this directory, and the
// renderer cannot drift from the model it renders.
// ---------------------------------------------------------------------------

import type { DomainProfile, PrimitiveInstance, RelationInstance } from "@fdpm/cli";
import { AnnotationError, parseAnnotations, type Relationship } from "../annotations.js";
import type { Layer } from "../vocabulary.js";

/** One field that names another record. */
export interface ReferenceField {
  /** Field name on the referring type. */
  field: string;
  /** Type id the reference resolves to; `*` when the reference is polymorphic. */
  targetTypeId: string;
  /** Lifecycle ownership the profile declares for the reference. */
  relationship: Relationship;
}

/**
 * Recover every reference a type declares.
 *
 * @remarks
 * A field whose description carries a malformed annotation yields no
 * reference. That is the only sound reading: the annotation text is what
 * names the target, so a description that cannot be parsed does not name one,
 * and a renderer that guessed would nest a record under the wrong parent. The
 * profile's own annotations are written through `annotate()` and covered by
 * `tests/annotations.test.ts`, which is where a malformed one is caught loudly.
 *
 * @param profile - The profile to read.
 * @param typeId - Primitive type whose fields are inspected.
 * @returns Its reference fields, in declaration order; empty when the profile
 * declares no such type.
 */
export function referenceFields(profile: DomainProfile, typeId: string): ReferenceField[] {
  const type = profile.primitive_types.find((t) => t.id === typeId);
  if (type === undefined) return [];

  const out: ReferenceField[] = [];
  for (const field of type.fields) {
    let annotations;
    try {
      annotations = parseAnnotations(field.description ?? "");
    } catch (err) {
      if (err instanceof AnnotationError) continue;
      throw err;
    }
    const { fk, relationship } = annotations;
    if (fk === undefined || relationship === undefined) continue;
    out.push({
      field: field.name,
      targetTypeId: fk.endsWith(".id") ? fk.slice(0, -".id".length) : fk,
      relationship,
    });
  }
  return out;
}

/**
 * Read the FRBR layer a type is pinned to.
 *
 * @param profile - The profile to read.
 * @param typeId - Primitive type to look up.
 * @returns Its layer, or `undefined` for a type that sits outside the layering.
 */
export function layerOfType(profile: DomainProfile, typeId: string): Layer | undefined {
  const pinned = profile.primitive_types
    .find((t) => t.id === typeId)
    ?.fields.find((f) => f.name === "layer")?.enum_values?.[0];
  return pinned as Layer | undefined;
}

/** A reference that names a record the workbook does not contain. */
export interface DanglingReference {
  /** Record carrying the reference. */
  fromId: string;
  /** Field the reference sits in. */
  field: string;
  /** Id the field names. */
  toId: string;
  /** Lifecycle ownership the profile declares for the reference. */
  relationship: Relationship;
}

/** The workbook, indexed the way both renderers need to walk it. */
export interface WorkbookIndex {
  /** Every primitive, by id. */
  byId: ReadonlyMap<string, PrimitiveInstance>;
  /** Composition parent of each record that declares one that resolves. */
  parentOf: ReadonlyMap<string, string>;
  /** Ids of the records each parent owns, sorted. */
  childrenOf: ReadonlyMap<string, readonly string[]>;
  /** Records with no resolvable composition parent, sorted. */
  rootIds: readonly string[];
  /** Edges leaving each record, sorted by id. */
  edgesFrom: ReadonlyMap<string, readonly RelationInstance[]>;
  /** Edges arriving at each record, sorted by id. */
  edgesTo: ReadonlyMap<string, readonly RelationInstance[]>;
  /** Every reference, of any relationship, naming a record that is absent. */
  dangling: readonly DanglingReference[];
  /**
   * Records whose composition link was cut because following it closed a cycle.
   *
   * Each is a root in {@link WorkbookIndex.rootIds}. Without the cut, a cycle
   * of composition references would leave every record in it with a parent
   * and therefore in no root's subtree, so the whole cycle would silently
   * vanish from any document built by walking the forest.
   */
  cycleBroken: readonly string[];
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

/**
 * Index a workbook slice into the containment forest and edge maps.
 *
 * @remarks
 * Every collection is sorted by id, so the index -- and therefore any document
 * built from it -- is a function of the workbook's content and not of the
 * order the host happened to hand the records over.
 *
 * @param profile - Profile governing the workbook.
 * @param primitives - Records to index.
 * @param relations - Edges to index.
 * @returns The indexed workbook.
 */
export function indexWorkbook(
  profile: DomainProfile,
  primitives: readonly PrimitiveInstance[],
  relations: readonly RelationInstance[],
): WorkbookIndex {
  const sorted = [...primitives].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(sorted.map((p) => [p.id, p]));

  const referencesByType = new Map<string, ReferenceField[]>();
  const referencesFor = (typeId: string): ReferenceField[] => {
    const cached = referencesByType.get(typeId);
    if (cached !== undefined) return cached;
    const computed = referenceFields(profile, typeId);
    referencesByType.set(typeId, computed);
    return computed;
  };

  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  const dangling: DanglingReference[] = [];

  for (const primitive of sorted) {
    for (const reference of referencesFor(primitive.type_id)) {
      const raw = primitive.field_values[reference.field];
      if (typeof raw !== "string" || raw === "") continue;
      if (!byId.has(raw)) {
        dangling.push({
          fromId: primitive.id,
          field: reference.field,
          toId: raw,
          relationship: reference.relationship,
        });
        continue;
      }
      // Only composition nests: an aggregation reference crosses an ownership
      // boundary, so rendering a track inside the agent that published it
      // would assert a containment the profile does not declare.
      if (reference.relationship !== "composition") continue;
      if (parentOf.has(primitive.id)) continue;
      parentOf.set(primitive.id, raw);
      pushInto(childrenOf, raw, primitive.id);
    }
  }

  // Cut every composition cycle before the forest is read, walking from each
  // record in id order so which link gives way is a function of the workbook
  // and not of the order the host handed the records over.
  const cycleBroken: string[] = [];
  for (const primitive of sorted) {
    const seen = new Set<string>();
    let cursor: string | undefined = primitive.id;
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
    if (cursor === undefined) continue;
    const parent = parentOf.get(cursor);
    if (parent === undefined) continue;
    parentOf.delete(cursor);
    const siblings = childrenOf.get(parent);
    if (siblings !== undefined) {
      const at = siblings.indexOf(cursor);
      if (at >= 0) siblings.splice(at, 1);
    }
    cycleBroken.push(cursor);
  }
  cycleBroken.sort((a, b) => a.localeCompare(b));

  for (const [, children] of childrenOf) children.sort((a, b) => a.localeCompare(b));

  const rootIds = sorted.filter((p) => !parentOf.has(p.id)).map((p) => p.id);

  const edgesFrom = new Map<string, RelationInstance[]>();
  const edgesTo = new Map<string, RelationInstance[]>();
  for (const relation of [...relations].sort((a, b) => a.id.localeCompare(b.id))) {
    pushInto(edgesFrom, relation.source_id, relation);
    pushInto(edgesTo, relation.target_id, relation);
  }

  dangling.sort((a, b) => a.fromId.localeCompare(b.fromId) || a.field.localeCompare(b.field));

  return { byId, parentOf, childrenOf, rootIds, edgesFrom, edgesTo, dangling, cycleBroken };
}

/** Human-readable name of a type, falling back to its id. */
export function typeName(profile: DomainProfile, typeId: string): string {
  return (
    profile.primitive_types.find((t) => t.id === typeId)?.name ??
    profile.relation_types.find((t) => t.id === typeId)?.name ??
    typeId
  );
}

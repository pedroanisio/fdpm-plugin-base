# Architecture — mapping a Zod media schema onto the FDPM meta-model

Back to the [root README](../README.md).

The source model is a TypeScript/Zod schema for heterogeneous media: four FRBR
layers, discriminated unions per media family, identifiers that declare the
layer they address, association edges carrying their own provenance, and W3C
Web Annotation selectors. This profile carries that design into FDPM, whose
meta-model is a different shape. This document records where the two agree,
where they do not, and what was chosen instead.

---

## 1. What the meta-model changes

| Source construct                          | FDPM expression                                                    | Consequence                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `z.discriminatedUnion("resourceType", …)` | One `PrimitiveTypeDef` per variant; `type_id` is the discriminator | The discriminator is structural. No `resourceType` field is needed or kept.                                                                            |
| `layer: z.literal("work")`                | `kind: "enum"` with exactly one value                              | The meta-model has no literal type. A pinned enum is the nearest exact equivalent, and it holds: an ISBN on an expression stays unrepresentable.       |
| `assertedSchema(inner)` wrapper           | Assertion fields flattened onto the relation type                  | There is no generic wrapper. An edge is where epistemic status belongs anyway.                                                                         |
| `identifiers: Identifier[]` embedded      | `media:Identifier` as its own primitive type                       | An embedded discriminated union would be `kind: "json"` — untyped and unvalidatable. As a record, the host checks the registry's syntax and its layer. |
| `LocalizedText.values` as a locale map    | A typed list of `{locale, text}`                                   | An object keyed at runtime is `json`, which rule 1 admits only as a declared extension point. A locale map is not an escape hatch.                     |
| `ACYCLIC_PREDICATES` + `findCycle`        | Same list, enforced by a code validator                            | Unchanged: no schema language expresses graph topology.                                                                                                |
| `x-unit`, `x-fk`, `x-sensitivity`, …      | Bracketed annotations inside `description`                         | `FieldDef` is a strict Zod object and rejects unknown keys. See §2.                                                                                    |

## 2. Annotations inside `description`

The schema-design standard requires unit, timezone, ownership, sensitivity and
foreign-key target to be recoverable from the schema alone. The FDPM `FieldDef`
accepts no `x-*` keys, so they ride inside `description` in a bracketed form:

```
"Running time of the recording. [x-unit: seconds]"
```

`src/annotations.ts` encodes and parses that form losslessly, rejecting unknown
keys and out-of-domain values. This is a convention, and a convention decays —
so `tests/schema-rules.test.ts` parses every field's annotations and fails the
build when a numeric field has no unit, a reference no target, or a list no
ordering. The annotation is a contract because a gate reads it.

**Rejected:** carrying the annotations in a sidecar JSON file. It would drift
from the profile within one change, and a consumer reading the profile through
the host's API would never see it.

## 3. Composition by key, association by edge

A track cannot exist without its release, so `media:MusicTrack.releaseId` is an
`id-ref` field annotated `x-relationship: composition`. An adaptation, a
citation, a sample or a reply crosses ownership boundaries and is frequently
asserted rather than known, so each is a relation type carrying its own
`assertionKind`, `confidence`, `assertedBy` and `assertedAt`.

Multi-valued associations are edges, never lists of references. Genres,
contributors, topics and mentions were all list-of-reference fields in the
source; here they are `media:HasGenre`-style edges. That keeps every reference
singly typed and gives each association a place to carry its provenance.

**Rejected:** one `media:Relation` type with a `predicate` enum, as the source
models it. It would collapse 23 typed endpoint pairs into one untyped pair, and
the host could no longer reject an `inReplyTo` from a music release. The cost of
the choice made is 23 relation types instead of one; they are generated from a
single table in `src/relations.ts`.

## 4. The identifier invariant

The source model's headline claim is that a mislayered identifier is caught by
validation rather than by code review. That is preserved and extended:

1. The scheme must be one of the 21 registries, or `other` with a namespaced
   registry name.
2. The value must match that registry's anchored syntax pattern.
3. The layer the identifier declares must equal the layer the registry
   addresses — unless the registry declares `unspecified`, as DOI does, where
   the check stands down rather than guessing.
4. The referent must exist in the workbook, and its own `layer` must match.

Check 4 is what the source model could not do, because a Zod schema cannot see
a sibling record. It needs the workbook slice; when the host does not supply
one, the validator reports that it could not run rather than reporting a clean
write.

## 5. Deliberate deviations from the source

- **`abridgementOf` is acyclic.** The source lists it as cycle-tolerant. An
  abridgement of an abridgement is a partial order; a cycle is a data error.
- **Inverse predicates are not storable.** The source enumerates `citedBy`,
  `hasPart`, `isVersionOf` and `isReplacedBy` alongside their forward forms.
  Storing both directions makes two records of one fact that can disagree, so
  only the forward predicate is a relation type and the inverse is a name in
  `INVERSE_PREDICATES`.
- **`remixOf`, `coverOf` and `samples` tolerate cycles, bounded by depth.** Two
  artists sampling each other is a fact, not a data error.
- **`Rating.value` became `Rating.score`.** `value` already meant "the
  identifier as issued" on `media:Identifier`; one name for two concepts is the
  drift rule 17 exists to catch.
- **`workId` became `compositionId`, `literaryWorkId` and `movieWorkId`.** One
  name pointed at three different target types, so no consumer could tell what
  it resolved against.

## 6. Recorded waivers

Two fields deviate from rule 13 (foreign keys name a declared target). Both are
recorded with `x-waiver` in the profile itself, per the standard's §0.5, and
pinned by a test so the list cannot grow quietly:

| Field                              | Why                                                                     | Compensating control                                                                |
| ---------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `media:Identifier.identifiesId`    | An identifier names a record at any layer; `ref_type_id` holds one type | `validateIdentifier` resolves the referent and rejects a dangling or mislayered one |
| `media:ProviderRecord.describesId` | A provider record describes any record                                  | The `sameAs` edge carries the cross-provider claim, with its own assertion status   |

## 7. Evolution policy

`PROFILE_VERSION` is a literal semver in `src/vocabulary.ts`, and every record
carries `schemaVersion`, so a document from another major version fails
validation rather than parsing partially.

| Change                                                           | Classification                    |
| ---------------------------------------------------------------- | --------------------------------- |
| Add an optional field, a new primitive type, a new relation type | Minor                             |
| Widen an enum, relax a bound                                     | Minor, with caution for producers |
| Add a required field without a default                           | Major                             |
| Remove a field, narrow an enum, tighten a bound, rename anything | Major                             |
| Description or annotation only                                   | Patch                             |

A field scheduled for removal is annotated `x-deprecated`, `x-deprecated-since`,
`x-replaced-by` and `x-sunset` in the same version it is deprecated;
`tests/schema-rules.test.ts` fails a deprecation missing any of the three
companions.

## 8. Rendering

Two `cap:renderer` capabilities, both `text/markdown`:
`media:CatalogueRenderer` (the target's default, because the profile declares
it first) and `media:AnnotationIndexRenderer` (selected by id).

### Why not the host's generic renderer

Every profile the host resolves bears a runnable renderer: when a profile
declares no bindings, `ProfileRegistry.getResolved` appends
`core:WorkbookRenderer`, which groups records by `type_id` and prints a table
per group. That is the right thing to do knowing no domain — and it is the
wrong thing for this one. This profile's meaning is the spine: which work a
recording realizes, which release carries a track, which registry names which
layer. A table per type shows every one of those as an opaque id in a cell, and
a reader cannot reconstruct the spine from it.

### The spine is read from the profile, not from a list beside it

Neither renderer carries a table of type names or foreign-key fields. Every
reference in this profile already declares its target and its lifecycle
ownership as `[x-fk]` and `[x-relationship]` inside the field description (§2),
and every resource type pins its `layer` (§1). `src/renderers/model.ts` reads
both back out at render time: composition references become the containment
forest, and the pinned layer decides which section a record appears in.

A renderer that instead listed `MusicRecording.compositionId`,
`MusicTrack.releaseId` and the rest would be a second copy of the model, and
the copy would fall behind the first time a type was added. This is the same
argument that put the annotations in `description` rather than a sidecar.

**Rejected:** hardcoding the spine for speed. The scan is over ~29 types once
per render, memoized per type; the cost is not measurable against reading a
workbook.

### Cycles are cut in the index, not guarded in the walk

Composition references are meant to form a forest, and nothing in the
meta-model enforces it. A cycle would give every record in it a parent, so
none would be a root, so a forest walk would render none of them at all — the
records would not merely be misplaced, they would be absent, and an absent
record is invisible. `indexWorkbook` therefore cuts the link that closes a
cycle before the forest is read, reports each cut, and hands the renderer a
structure whose traversal terminates by construction.

That is also why there is no depth cap on the walk. A cap would truncate a
chain that is merely long, silently dropping records to guard against a
condition the index has already removed.

### Refusal is in-band

A renderer asked for a workbook governed by another profile emits a document
saying so, plus a finding — it does not raise. The host treats any exception
that is not its own `FDPMException` as a plugin defect and quarantines the
plugin that raised it, and `FDPMException` is reachable only through a runtime
import of `@fdpm/cli`. Every import of that package here is `import type`,
erased at compile time, because a deployed plugin directory is `dist/` copied
without `node_modules` and could not resolve a value import. So a caller who
points `--renderer-id media:CatalogueRenderer` at a UML workbook gets a refusal
and a non-zero `--strict` exit, and the media plugin stays active.

`src/exporter.ts` is deliberately not changed to match. An exporter's output is
JSON-LD, and there is no refusal document that is both valid JSON-LD and
honest — an empty `@graph` asserts that the workbook has no records. Refusing
by raising is the correct behaviour there; that the host responds by
quarantining the plugin is a gap in the host contract, not something this
plugin should paper over by emitting bytes that lie.

### Findings are the report, omission is not

Every record the workbook holds appears somewhere in the catalogue, including
the ones whose references are broken: a record rendered with a reported defect
is inspectable, one silently dropped is not, and a document that omits records
disagrees with the workbook it claims to describe. Identifiers are the one type
rendered against another record rather than in their own table, so the ones
whose `identifiesId` does not resolve are listed separately — which keeps the
guarantee whole rather than making an exception to it.

The host's `RenderFinding` shape was defined for the template DSL, so
`templateId` carries the renderer id and `line`/`column` are zero. It is the
only findings channel a renderer has, and it is load-bearing:
`fdpm render --strict` sets a verification exit code when any finding is
present.

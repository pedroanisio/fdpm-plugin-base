# Review Scorecard — profile:media:1.0 v0.1.0

Back to the [root README](../README.md).

Scored against **Rules for Great Schema Design v2.0.0**
(`.repo/skills/schema-designer/references/schema-design-rules.md`).

Every row marked _gated_ is enforced by an assertion in
`tests/schema-rules.test.ts` and fails the build when broken. Rows that are not
gated were judged by reading the profile, and are marked so the reader knows
which is which.

## Part I — Type safety and precision

| #   | Rule                                  | Tier   | Score | Evidence                                                                                                                                                                                          |
| --- | ------------------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Single unambiguous type               | MUST   | Pass  | _Gated._ Every field declares a `kind`; `json` appears only on `extensions` and `rawPayload`, both annotated `x-extension-point`.                                                                 |
| 2   | Constraints in the schema             | MUST   | Pass  | _Gated._ Bounds live in `validations` (`min`, `max`, `max_length`, `max_items`, `pattern`); a prose bound with no validation fails the build.                                                     |
| 3   | Closed, versioned enums               | MUST   | Pass  | _Gated._ Every enum is non-empty and duplicate-free. Widening is a minor bump per §7 of the architecture note.                                                                                    |
| 4   | Nullable ≠ optional ≠ absent          | MUST   | Pass  | _Gated._ `licenseIri` and `deletedAt` declare `nullable: true`; any field whose prose says "null" without it fails.                                                                               |
| 5   | Arrays: item type, cardinality, order | MUST   | Pass  | _Gated._ Every list declares `item_field`, `max_items` and `x-ordering`.                                                                                                                          |
| 6   | Temporal precision and format         | MUST   | Pass  | _Gated._ Instants are `kind: "datetime"` with `x-timezone: UTC` and `x-precision: seconds`; partial dates are EDTF with `x-precision: edtf`. A field named `*At`/`*Date` without precision fails. |
| 7   | Numeric units declared                | MUST   | Pass  | _Gated._ Every `integer` and `number` field carries `x-unit` — seconds, bytes, pixels, hertz, ordinal, probability, percent.                                                                      |
| 8   | Explicit discriminator                | MUST   | Pass  | _Gated._ `type_id` is the structural discriminator; `layer` is pinned to one value per resource type and `predicate` to one per relation type.                                                    |
| 9   | Defaults declared                     | SHOULD | Pass  | _Gated._ Every boolean declares a default.                                                                                                                                                        |

## Part II — Identity and relationships

| #   | Rule                                             | Tier | Score    | Evidence                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------ | ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | Stable, opaque identity                          | MUST | Pass     | Not gated beyond `id_format`. The host assigns every instance an opaque ULID `uid`; the authored `id` is the stable business key, constrained per type by an `id_format` regex.                                                                                                                                                     |
| 11  | Navigable relationships                          | MUST | Pass     | Not gated. Composition is a typed `id-ref`; every association is a relation type with declared endpoints.                                                                                                                                                                                                                           |
| 12  | Composition / aggregation / association explicit | MUST | Pass     | _Gated._ Every reference declares `x-relationship`; every relation type declares it too.                                                                                                                                                                                                                                            |
| 13  | FK targets declared                              | MUST | **Warn** | _Gated for `id-ref`._ Two polymorphic references — `media:Identifier.identifiesId` and `media:ProviderRecord.describesId` — name any record and carry an `x-waiver` in the profile per §0.5. A test pins the waiver list at exactly those two. `validateIdentifier` resolves the referent and rejects a dangling or mislayered one. |
| 14  | Cyclic topology declared                         | MUST | Pass     | _Gated._ Every relation type declares `x-graph-constraint`; the nine acyclic predicates are `DAG`, the rest `allow-cycles` with `x-max-depth: 12`. `validateAcyclic` enforces it.                                                                                                                                                   |

## Part III — Normalization and coherence

| #   | Rule                             | Tier   | Score | Evidence                                                                                                                                                                                                                        |
| --- | -------------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15  | One source of truth per fact     | MUST   | Pass  | Not gated directly. `predicate` restates the relation type id and is annotated `x-derivation: derived-cached` with `x-derived-from`. Metrics are timestamped snapshots, never facts.                                            |
| 16  | No bag-of-arrays entities        | SHOULD | Pass  | Not gated. Every type carries scalars and provenance beyond its lists.                                                                                                                                                          |
| 17  | Cross-cutting types defined once | SHOULD | Pass  | _Gated._ One name may not carry two shapes. Pinned discriminators are exempt, because rule 8 requires them to differ per variant. Caught `workId` naming three target types and `value` naming two concepts; both were renamed. |
| 18  | Computed vs stored distinguished | SHOULD | Pass  | _Gated._ A field annotated as derived must name what it derives from.                                                                                                                                                           |

## Part IV — Evolution and compatibility

| #   | Rule                           | Tier | Score | Evidence                                                                                                                    |
| --- | ------------------------------ | ---- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| 19  | Explicit, monotonic versioning | MUST | Pass  | _Gated._ `PROFILE_VERSION` is a literal semver; every record carries `schemaVersion`, annotated immutable.                  |
| 20  | No duplicate-version entities  | MUST | Pass  | _Gated._ No type id carries a version suffix.                                                                               |
| 21  | Breaking changes classified    | MUST | Pass  | Not gated. The classification matrix is in the architecture note, §7.                                                       |
| 22  | Deprecation annotated          | MUST | Pass  | _Gated._ A field annotated `x-deprecated` must also declare since, replacement and sunset. No field is deprecated at 0.1.0. |

## Part V — Operational annotations

| #   | Rule                             | Tier   | Score | Evidence                                                                                                                                 |
| --- | -------------------------------- | ------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 23  | Sensitive fields classified      | MUST*  | Pass  | _Gated._ `media:Agent.birthDate` and `deathDate` carry `x-sensitivity: pii`. The profile holds personal data, so the rule binds as MUST. |
| 24  | Identity/provenance immutability | SHOULD | Pass  | _Gated._ `createdAt`, `createdBy`, `sourceSystem` and `schemaVersion` are annotated immutable.                                           |
| 25  | Localization strategy declared   | SHOULD | Pass  | _Gated._ Every localized field declares `x-localization: locale-map`; `media:localized-text` names its authoritative entry explicitly.   |
| 26  | Multi-actor provenance           | SHOULD | Pass  | _Gated._ Every primitive type carries the `media:provenance` struct.                                                                     |

## Part VI — Documentation and generability

| #   | Rule                                    | Tier   | Score | Evidence                                                                                                                                                |
| --- | --------------------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27  | Consistent naming                       | MUST   | Pass  | _Gated._ camelCase field names, `Id`/`Ids` suffix on references, `is`/`has` prefix on booleans, plural list names, `media:` namespace on every type id. |
| 28  | Mechanically generatable                | MUST   | Pass  | _Gated._ The profile parses against the host's own `DomainProfile` schema, from which the host generates its validators.                                |
| 29  | Intentional extension points            | MUST   | Pass  | _Gated._ `extensions` and `rawPayload` are annotated; an unannotated `json` field fails the build.                                                      |
| 30  | Access patterns don't dictate structure | SHOULD | Pass  | Not gated. The only embedded aggregate is `metricsSnapshot`, which carries `observedAt`.                                                                |
| 31  | Readable standalone                     | MUST   | Pass  | _Gated._ Every field and type carries a description of substance; a stub fails the build.                                                               |

## Totals

- **MUST: 19 Pass, 1 Warn (rule 13), 0 Fail** — of 20. The warn carries a
  waiver recorded in the profile itself, as §0.5 requires, with a compensating
  validator.
- **SHOULD: 11 Pass, 0 documented deviations** — of 11.

## Assumptions

Recorded because the operator did not specify them:

1. **Scope.** Three media families are modelled end to end — music, text and
   editorial, audiovisual and social. The source model's remaining variants
   (`BlogPosting`, `WebPage`, `TvSeasonWork`, `TvEpisodeWork`, `AvRelease`)
   are absent; adding each is a minor bump, and the layer spine they attach to
   is already here.
2. **Profile version 0.1.0, not 1.0.0.** The source schema is 1.0.0, but this
   profile does not cover it in full, and 1.0.0 would claim a stability the
   coverage does not support.
3. **Identifiers as records, not embedded values.** This is the largest
   departure from the source and the reason the layer invariant can be checked
   against the referent rather than against the declaration alone.
4. **No renderer.** `cap:renderer` is unclaimed; the JSON-LD exporter covers
   the interchange case, and a human-readable rendering has no agreed shape yet.

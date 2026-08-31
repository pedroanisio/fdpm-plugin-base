// ---------------------------------------------------------------------------
// profile -- assembly of the DomainProfile this plugin contributes.
//
// The parts are declared in their own modules; this joins them and is the
// single place the profile's identity, categories, scopes, types, structs and
// rules come together.
// ---------------------------------------------------------------------------

import type { DomainProfile } from "@fdpm/cli";
import { PRIMITIVE_TYPES, CATEGORIES, RESOURCE_TYPE_IDS, SCOPES } from "./primitives.js";
import { RELATION_TYPES, RELATION_TYPE_IDS } from "./relations.js";
import { STRUCTS } from "./structs.js";
import { buildValidationRules } from "./validation-rules.js";
import { PROFILE_ID, PROFILE_VERSION } from "./vocabulary.js";

/** Types carrying a start/end time pair the range rule applies to. */
const TIME_RANGE_TYPES = PRIMITIVE_TYPES.filter((t) =>
  t.fields.some((f) => f.name === "startTime"),
).map((t) => t.id);

/** Types carrying a start/end page pair the range rule applies to. */
const PAGE_RANGE_TYPES = PRIMITIVE_TYPES.filter((t) =>
  t.fields.some((f) => f.name === "startPage"),
).map((t) => t.id);

/**
 * The media domain profile.
 *
 * @remarks
 * Four FRBR layers, pinned per type so a track cannot be typed as a work;
 * composition by foreign key and association by edge; identifiers as
 * first-class records so the registry's syntax and the layer it addresses can
 * both be checked against the record they name.
 */
export const PROFILE: DomainProfile = {
  id: PROFILE_ID,
  version: PROFILE_VERSION,
  label: "Media",
  name: "Media",
  description:
    "A standards-aligned domain profile for heterogeneous media -- music, film, television, books, journalism, scholarship, social posts and platform video -- and for annotations attached to whole resources or to precise fragments of them. Layered on FRBR: work, expression, manifestation, asset.",
  extends: [],
  categories: [...CATEGORIES],
  scopes: [...SCOPES],
  primitive_types: PRIMITIVE_TYPES,
  relation_types: RELATION_TYPES,
  validation_rules: buildValidationRules({
    timeRangeTypes: TIME_RANGE_TYPES,
    pageRangeTypes: PAGE_RANGE_TYPES,
  }),
  renderer_bindings: [],
  renderers: [],
  inline_structs: STRUCTS,
  templates: [],
  scope_sets: { catalogue: ["scope:media:catalogue"], collection: ["scope:media:collection"] },
  default_scope_set: "catalogue",
};

/** Primitive type ids carrying localized fields, for validator registration. */
export const PROFILE_RESOURCE_TYPE_IDS = RESOURCE_TYPE_IDS;

/** Relation type ids carrying assertion metadata, for validator registration. */
export const PROFILE_RELATION_TYPE_IDS = RELATION_TYPE_IDS;

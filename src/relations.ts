// ---------------------------------------------------------------------------
// relations -- association edges, one relation type per predicate.
//
// Composition stays a foreign key: a track cannot exist without its release,
// so `MusicTrack.releaseId` is a field. Association becomes an edge, because
// an adaptation, a citation, a sample or a reply crosses ownership boundaries
// and is frequently asserted rather than known -- so it carries its own
// provenance, its own confidence, and its own epistemic status.
// ---------------------------------------------------------------------------

import type { FieldDefT, RelationTypeDef } from "@fdpm/cli";
import { annotate } from "./annotations.js";
import { choice, decimal, instant, item, iri, list, text } from "./fields.js";
import { TYPES_BY_LAYER } from "./primitives.js";
import {
  ACYCLIC_PREDICATES,
  ASSERTION_KINDS,
  MAX_CYCLIC_DEPTH,
  RELATION_PREDICATES,
  type RelationPredicate,
} from "./vocabulary.js";
import { relationTypeIdFor } from "./validators.js";

const WORKS = TYPES_BY_LAYER.work;
const EXPRESSIONS = TYPES_BY_LAYER.expression;
const MANIFESTATIONS = TYPES_BY_LAYER.manifestation;
const ASSETS = TYPES_BY_LAYER.asset;
const RESOURCES = [...WORKS, ...EXPRESSIONS, ...MANIFESTATIONS, ...ASSETS];
const AUTHORED = [...MANIFESTATIONS, "media:Annotation"];

/**
 * Provenance every edge carries.
 *
 * This is the source model's `asserted` wrapper, flattened: the meta-model has
 * no generic wrapper, and an edge is exactly the place its epistemic status
 * belongs.
 */
function assertionFields(): FieldDefT[] {
  return [
    choice("assertionKind", "Epistemic status of the claim this edge makes.", ASSERTION_KINDS, {
      required: true,
    }),
    decimal(
      "confidence",
      "Confidence in the claim. Required for an inference, forbidden for a fact.",
      "probability",
      {
        min: 0,
        max: 1,
      },
    ),
    text("assertedBy", "Agent, model or system that asserted the edge.", 200, { required: true }),
    instant("assertedAt", "When the edge was asserted.", { required: true }),
    list(
      "evidenceIris",
      "Documents supporting the assertion.",
      item("string", 2048),
      "insignificant",
      50,
    ),
    instant("observedAt", "When the underlying fact was observed, where that differs."),
    iri("objectIri", "External target, used when the object lies outside this workbook."),
    decimal(
      "subjectStartTime",
      "Start of the span on the subject that the edge applies to.",
      "seconds",
      {
        min: 0,
      },
    ),
    decimal(
      "subjectEndTime",
      "End of the span on the subject that the edge applies to.",
      "seconds",
      {
        min: 0,
      },
    ),
  ];
}

interface PredicateSpec {
  predicate: RelationPredicate;
  name: string;
  description: string;
  sources: readonly string[];
  targets: readonly string[];
}

/** Endpoint and prose declaration for every predicate the profile carries. */
const SPECS: readonly PredicateSpec[] = [
  {
    predicate: "adaptationOf",
    name: "Adaptation of",
    description: "The subject reworks the object into another medium or form.",
    sources: [...EXPRESSIONS, ...MANIFESTATIONS],
    targets: WORKS,
  },
  {
    predicate: "translationOf",
    name: "Translation of",
    description: "The subject renders the object in another language.",
    sources: EXPRESSIONS,
    targets: EXPRESSIONS,
  },
  {
    predicate: "abridgementOf",
    name: "Abridgement of",
    description: "The subject shortens the object while keeping its substance.",
    sources: EXPRESSIONS,
    targets: EXPRESSIONS,
  },
  {
    predicate: "revisionOf",
    name: "Revision of",
    description: "The subject supersedes the object as a corrected or expanded text.",
    sources: [...EXPRESSIONS, ...MANIFESTATIONS],
    targets: [...EXPRESSIONS, ...MANIFESTATIONS],
  },
  {
    predicate: "remixOf",
    name: "Remix of",
    description: "The subject rearranges the object's recorded material.",
    sources: EXPRESSIONS,
    targets: EXPRESSIONS,
  },
  {
    predicate: "coverOf",
    name: "Cover of",
    description: "The subject performs the object's composition anew.",
    sources: EXPRESSIONS,
    targets: [...WORKS, ...EXPRESSIONS],
  },
  {
    predicate: "samples",
    name: "Samples",
    description: "The subject incorporates a fragment of the object's recording.",
    sources: EXPRESSIONS,
    targets: EXPRESSIONS,
  },
  {
    predicate: "derivedFrom",
    name: "Derived from",
    description: "The subject was produced from the object by some transformation.",
    sources: RESOURCES,
    targets: RESOURCES,
  },
  {
    predicate: "cites",
    name: "Cites",
    description:
      "The subject references the object as a source. Stored one way only; the inverse is implied.",
    sources: AUTHORED,
    targets: RESOURCES,
  },
  {
    predicate: "hasVersion",
    name: "Has version",
    description:
      "The object is a version of the subject. Stored one way only; the inverse is implied.",
    sources: RESOURCES,
    targets: RESOURCES,
  },
  {
    predicate: "replaces",
    name: "Replaces",
    description:
      "The subject supersedes the object outright. Stored one way only; the inverse is implied.",
    sources: RESOURCES,
    targets: RESOURCES,
  },
  {
    predicate: "partOf",
    name: "Part of",
    description:
      "The subject is a structural part of the object without being owned by it, as an episode is part of a series.",
    sources: RESOURCES,
    targets: RESOURCES,
  },
  {
    predicate: "memberOfCollection",
    name: "Member of collection",
    description: "The subject belongs to a curated set, which it may outlive.",
    sources: RESOURCES,
    targets: ["media:Collection"],
  },
  {
    predicate: "inReplyTo",
    name: "In reply to",
    description: "The subject answers the object in a thread.",
    sources: ["media:SocialPost", "media:Comment", "media:Review"],
    targets: [...MANIFESTATIONS],
  },
  {
    predicate: "quoteOf",
    name: "Quote of",
    description: "The subject republishes the object with commentary of its own.",
    sources: ["media:SocialPost"],
    targets: MANIFESTATIONS,
  },
  {
    predicate: "repostOf",
    name: "Repost of",
    description: "The subject forwards the object unchanged and carries no body of its own.",
    sources: ["media:SocialPost"],
    targets: MANIFESTATIONS,
  },
  {
    predicate: "attributedTo",
    name: "Attributed to",
    description:
      "The subject is credited to the object. Carries the role and the billing position of the credit.",
    sources: RESOURCES,
    targets: ["media:Agent"],
  },
  {
    predicate: "mentions",
    name: "Mentions",
    description: "The subject names the object in its content.",
    sources: AUTHORED,
    targets: [...RESOURCES, "media:Agent", "media:Concept"],
  },
  {
    predicate: "soundtrackFor",
    name: "Soundtrack for",
    description: "The subject is music written or compiled for the object.",
    sources: [...WORKS, ...EXPRESSIONS, ...MANIFESTATIONS],
    targets: [...WORKS, ...MANIFESTATIONS],
  },
  {
    predicate: "trailerFor",
    name: "Trailer for",
    description: "The subject promotes the object.",
    sources: MANIFESTATIONS,
    targets: [...WORKS, ...MANIFESTATIONS],
  },
  {
    predicate: "performanceOf",
    name: "Performance of",
    description: "The subject is a performance realizing the object's composition.",
    sources: EXPRESSIONS,
    targets: WORKS,
  },
  {
    predicate: "recordingOf",
    name: "Recording of",
    description: "The subject captures the object as a recording.",
    sources: EXPRESSIONS,
    targets: [...WORKS, ...EXPRESSIONS],
  },
  {
    predicate: "sameAs",
    name: "Same as",
    description:
      "The subject and object are asserted to be the same thing. A curated claim with known errors, never a merge.",
    sources: [...RESOURCES, "media:Agent", "media:Concept"],
    targets: [...RESOURCES, "media:Agent", "media:Concept"],
  },
];

/** Role a credit carries, on `attributedTo` edges. */
const CONTRIBUTOR_ROLES = [
  "author",
  "editor",
  "translator",
  "illustrator",
  "narrator",
  "composer",
  "lyricist",
  "performer",
  "producer",
  "director",
  "screenwriter",
  "cinematographer",
  "publisher",
  "distributor",
  "contributor",
] as const;

function fieldsFor(predicate: RelationPredicate, typeId: string): FieldDefT[] {
  const base: FieldDefT[] = [
    {
      name: "predicate",
      kind: "enum",
      required: true,
      enum_values: [predicate],
      validations: [],
      description: annotate(
        "Predicate this edge asserts. Pinned to one value: the relation type is the discriminator, and this field restates it so a consumer reading an edge alone can see which predicate it carries.",
        { derivation: "derived-cached", derivedFrom: `${typeId}.id` },
      ),
    },
    ...assertionFields(),
  ];
  if (predicate === "attributedTo") {
    base.push(choice("role", "Role the agent played.", CONTRIBUTOR_ROLES, { required: true }), {
      name: "billingPosition",
      kind: "integer",
      required: false,
      validations: [{ kind: "min", value: 1, level: "error" }],
      description: annotate(
        "Billing position of the credit, counting from one. Present because DCTERMS creator has neither role nor order while ONIX contributors have both.",
        { unit: "ordinal" },
      ),
    });
  }
  return base;
}

/** Every relation type the profile declares, one per predicate. */
export const RELATION_TYPES: RelationTypeDef[] = SPECS.map((spec) => {
  const id = relationTypeIdFor(spec.predicate);
  const acyclic = (ACYCLIC_PREDICATES as readonly string[]).includes(spec.predicate);
  return {
    id,
    name: spec.name,
    description: annotate(
      spec.description,
      acyclic
        ? { graphConstraint: "DAG", relationship: "association" }
        : {
            graphConstraint: "allow-cycles",
            maxDepth: MAX_CYCLIC_DEPTH,
            relationship: "association",
          },
    ),
    source_types: [...spec.sources],
    target_types: [...spec.targets],
    cardinality: "many-to-many",
    symmetric: spec.predicate === "sameAs",
    transitive: spec.predicate === "partOf" || spec.predicate === "derivedFrom",
    fields: fieldsFor(spec.predicate, id),
  };
});

/** Relation type ids, in predicate declaration order. */
export const RELATION_TYPE_IDS: string[] = RELATION_TYPES.map((r) => r.id);

/** Every predicate has exactly one relation type; asserted at module load. */
if (RELATION_TYPES.length !== RELATION_PREDICATES.length) {
  throw new Error(
    `relation types (${RELATION_TYPES.length}) do not cover every predicate (${RELATION_PREDICATES.length})`,
  );
}

// ---------------------------------------------------------------------------
// structs -- cross-cutting value types, defined once and referenced everywhere.
//
// Localized text, provenance, rights, metrics and ratings appear on most of
// the profile's types. Defining each here and referencing it by id is what
// stops the same concept drifting into several near-identical shapes.
// ---------------------------------------------------------------------------

import type { FieldDefT, InlineStructDef } from "@fdpm/cli";
import {
  choice,
  decimal,
  flag,
  instant,
  integer,
  iri,
  item,
  list,
  locale,
  structItem,
  text,
} from "./fields.js";
import { PROVENANCE_ACTIVITIES, SHA256_PATTERN } from "./vocabulary.js";

/** One locale's rendering of a localized value. */
export const LOCALIZED_VALUE = "media:localized-value";

/** Locale map with an explicit authoritative entry. */
export const LOCALIZED_TEXT = "media:localized-text";

/** Record-level provenance. */
export const PROVENANCE = "media:provenance";

/** Licensing and distribution terms. */
export const RIGHTS = "media:rights";

/** Platform counts observed at one moment. */
export const METRICS_SNAPSHOT = "media:metrics-snapshot";

/** A score together with the scale it was given on. */
export const RATING = "media:rating";

/** A published correction to an editorial item. */
export const CORRECTION = "media:correction";

/** One physical or digital carrier within a release. */
export const CARRIER = "media:carrier";

/** Every struct the profile defines, in dependency order. */
export const STRUCTS: InlineStructDef[] = [
  {
    id: LOCALIZED_VALUE,
    name: "LocalizedValue",
    description: "One locale's rendering of a localized value.",
    fields: [
      locale("locale", "BCP 47 tag this rendering is written in.", { required: true }),
      text("text", "The value as rendered in this locale.", 4000, { required: true }),
    ],
  },
  {
    id: LOCALIZED_TEXT,
    name: "LocalizedText",
    description:
      "Human-facing text in one or more locales, with the authoritative entry named explicitly so consumers never guess the fallback.",
    fields: [
      locale("primaryLocale", "Locale of the authoritative entry.", { required: true }),
      list(
        "values",
        "One entry per locale this value is available in.",
        structItem(LOCALIZED_VALUE),
        "insignificant",
        40,
        { required: true, minItems: 1 },
      ),
      list(
        "translatedLocales",
        "Locales whose entry was produced by machine translation rather than authored.",
        item("string", 35),
        "insignificant",
        40,
      ),
    ],
  },
  {
    id: PROVENANCE,
    name: "Provenance",
    description:
      "Who produced this record, from which system, and when. Carried by every type so that a disputed value can be traced to its source.",
    fields: [
      instant("createdAt", "When the record was first written.", {
        required: true,
        ann: { immutable: true },
      }),
      text("createdBy", "Actor or system that created the record.", 200, {
        required: true,
        ann: { immutable: true },
      }),
      instant("modifiedAt", "When the record was last changed."),
      text("modifiedBy", "Actor or system that last changed the record.", 200),
      text("sourceSystem", "Ingestion origin, such as musicbrainz or rss:nytimes.", 200, {
        required: true,
        ann: { immutable: true },
      }),
      iri("sourceIri", "The exact document the record was derived from."),
      integer("revision", "Monotonic per-record revision, incremented on every write.", "count", {
        required: true,
        min: 0,
      }),
      choice(
        "generatedByActivity",
        "PROV-O activity that produced this record.",
        PROVENANCE_ACTIVITIES,
        { required: true },
      ),
    ],
  },
  {
    id: RIGHTS,
    name: "Rights",
    description:
      "Licensing and distribution terms. An explicitly unlicensed work is distinct from one whose licence is unknown.",
    fields: [
      {
        ...iri("licenseIri", "SPDX identifier or licence IRI. Explicitly cleared when unlicensed."),
        nullable: true,
      },
      text("copyrightHolder", "Party holding copyright.", 300),
      integer("copyrightYear", "Year copyright was asserted.", "year", { min: 1400, max: 2200 }),
      list(
        "territories",
        "ISO 3166-1 alpha-2 codes where distribution is permitted.",
        item("string", 2),
        "insignificant",
        250,
      ),
      flag("isAccessibleForFree", "Whether the item is readable without payment.", false),
    ],
  },
  {
    id: METRICS_SNAPSHOT,
    name: "MetricsSnapshot",
    description:
      "Platform counts as observed at one moment. A snapshot, never a fact about the work, so it always carries the time it was taken.",
    fields: [
      instant("observedAt", "When the counts were read.", { required: true }),
      integer("viewCount", "Views reported by the platform.", "count", { min: 0 }),
      integer("likeCount", "Likes reported by the platform.", "count", { min: 0 }),
      integer("commentCount", "Comments reported by the platform.", "count", { min: 0 }),
      integer("repostCount", "Reposts reported by the platform.", "count", { min: 0 }),
      integer("replyCount", "Replies reported by the platform.", "count", { min: 0 }),
    ],
  },
  {
    id: RATING,
    name: "Rating",
    description:
      "A score together with the scale it was given on, because four out of five and four out of ten are not the same judgement.",
    fields: [
      decimal("score", "The score awarded.", "ratingPoints", { required: true }),
      decimal("worstScore", "Lowest score the scale permits.", "ratingPoints", { required: true }),
      decimal("bestScore", "Highest score the scale permits.", "ratingPoints", { required: true }),
    ],
  },
  {
    id: CORRECTION,
    name: "Correction",
    description: "A published correction to an editorial item, retained as part of its record.",
    fields: [
      instant("issuedAt", "When the correction was published.", { required: true }),
      {
        name: "note",
        kind: "struct",
        required: true,
        struct_id: LOCALIZED_TEXT,
        validations: [],
        description: "Text of the correction. [x-localization: locale-map]",
      } satisfies FieldDefT,
    ],
  },
  {
    id: CARRIER,
    name: "Carrier",
    description:
      "One physical or digital medium within a release, such as disc two of a double album.",
    fields: [
      integer("position", "Position of this carrier within the release.", "ordinal", {
        required: true,
        min: 1,
      }),
      choice(
        "format",
        "Carrier format.",
        ["cd", "vinyl", "cassette", "digital", "bluRay", "dvd", "other"],
        { required: true },
      ),
      integer("trackCount", "Tracks carried by this medium.", "count", { required: true, min: 0 }),
    ],
  },
];

/** Digest pattern reused by fields that anchor to an exact byte stream. */
export const CONTENT_HASH_PATTERN = SHA256_PATTERN;

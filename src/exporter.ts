// ---------------------------------------------------------------------------
// exporter -- project a workbook into JSON-LD.
//
// The profile's whole claim is standards alignment, and JSON-LD is where that
// claim is testable: schema.org supplies the classes, the W3C Web Annotation
// vocabulary the annotation terms, PROV-O the provenance ones. What has no
// agreed term keeps its profile id rather than being dropped or retyped,
// because a lossy export that looks clean is worse than one that admits it.
// ---------------------------------------------------------------------------

import type { PrimitiveInstance, ProjectTransfer, RelationInstance } from "@fdpm/cli";
import { PROFILE_ID } from "./vocabulary.js";
import { predicateOfRelationType } from "./validators.js";

/** Format token the host dispatches on. */
export const EXPORT_FORMAT = "media-jsonld" as const;

/** Raised when an export is asked for a workbook this profile does not govern. */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

/** Term definitions shared by every exported document. */
export const JSONLD_CONTEXT: Readonly<Record<string, string>> = {
  "@vocab": "https://schema.org/",
  schema: "https://schema.org/",
  oa: "http://www.w3.org/ns/oa#",
  dcterms: "http://purl.org/dc/terms/",
  prov: "http://www.w3.org/ns/prov#",
  as: "https://www.w3.org/ns/activitystreams#",
  cito: "http://purl.org/spar/cito/",
  media: "https://fdpm.dev/profile/media/1.0#",
};

/**
 * schema.org class for each type that has an agreed one.
 *
 * A type absent from this table has no faithful schema.org class. Exporting it
 * under an approximate one would assert something the model does not say, so
 * it keeps its profile id instead.
 */
const SCHEMA_ORG_TYPE: Readonly<Record<string, string>> = {
  "media:MusicComposition": "schema:MusicComposition",
  "media:LiteraryWork": "schema:CreativeWork",
  "media:MovieWork": "schema:Movie",
  "media:TvSeriesWork": "schema:TVSeries",
  "media:PodcastSeriesWork": "schema:PodcastSeries",
  "media:MusicRecording": "schema:MusicRecording",
  "media:TextExpression": "schema:CreativeWork",
  "media:AvCut": "schema:Movie",
  "media:MusicRelease": "schema:MusicAlbum",
  "media:MusicTrack": "schema:MusicRecording",
  "media:BookEdition": "schema:Book",
  "media:NewsArticle": "schema:NewsArticle",
  "media:ScholarlyArticle": "schema:ScholarlyArticle",
  "media:VideoPublication": "schema:VideoObject",
  "media:PodcastEpisode": "schema:PodcastEpisode",
  "media:SocialPost": "schema:SocialMediaPosting",
  "media:Comment": "schema:Comment",
  "media:Review": "schema:Review",
  "media:ComponentPart": "schema:CreativeWork",
  "media:ImageAsset": "schema:ImageObject",
  "media:AudioAsset": "schema:AudioObject",
  "media:VideoAsset": "schema:VideoObject",
  "media:TextAsset": "schema:MediaObject",
  "media:Concept": "schema:DefinedTerm",
  "media:Collection": "schema:Collection",
  "media:Annotation": "oa:Annotation",
  "media:Identifier": "schema:PropertyValue",
};

/** Localized value as stored, before projection to a JSON-LD language map. */
interface LocalizedShape {
  primaryLocale: string;
  values: { locale: string; text: string }[];
}

function asLocalized(raw: unknown): LocalizedShape | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate["primaryLocale"] !== "string" || !Array.isArray(candidate["values"])) {
    return null;
  }
  const values: { locale: string; text: string }[] = [];
  for (const entry of candidate["values"]) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row["locale"] !== "string" || typeof row["text"] !== "string") return null;
    values.push({ locale: row["locale"], text: row["text"] });
  }
  return { primaryLocale: candidate["primaryLocale"], values };
}

/** Project one stored value into its JSON-LD form. */
function project(raw: unknown): unknown {
  const localized = asLocalized(raw);
  if (localized !== null) {
    // A JSON-LD language map: `{ "en-US": "folklore" }`. The primary locale
    // survives as the entry a consumer resolves first by convention; the
    // model keeps the authoritative one, the serialization cannot.
    return Object.fromEntries(localized.values.map((v) => [v.locale, v.text]));
  }
  if (Array.isArray(raw)) return raw.map(project);
  if (typeof raw === "object" && raw !== null) {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, project(v)]),
    );
  }
  return raw;
}

/** Term a relation exports under. */
function edgeTerm(relation: RelationInstance): string {
  const declared = relation.field_values["predicate"];
  if (typeof declared === "string" && declared !== "") return declared;
  return predicateOfRelationType(relation.type_id) ?? relation.type_id;
}

/** Build one graph node from a stored primitive. */
function node(primitive: PrimitiveInstance): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "@id": primitive.id,
    "@type": SCHEMA_ORG_TYPE[primitive.type_id] ?? primitive.type_id,
  };
  for (const [name, raw] of Object.entries(primitive.field_values)) {
    if (raw === undefined) continue;
    out[name] = project(raw);
  }
  return out;
}

/**
 * Serialize a workbook as a JSON-LD document.
 *
 * @param transfer - The workbook slice the host hands to an exporter.
 * @returns UTF-8 bytes of the JSON-LD document.
 * @throws {@link ExportError} If the workbook declares another profile, whose
 * types this projection would silently mislabel.
 */
export function exportJsonLd(transfer: ProjectTransfer): Uint8Array {
  if (transfer.workbook.profile_id !== PROFILE_ID) {
    throw new ExportError(
      `media-jsonld exports ${PROFILE_ID}; this workbook declares ${transfer.workbook.profile_id}`,
    );
  }

  const nodes = new Map<string, Record<string, unknown>>();
  // Sorted by id so one workbook always serializes to one document: an export
  // that reorders between runs cannot be diffed or checksummed.
  for (const primitive of [...transfer.primitives].sort((a, b) => a.id.localeCompare(b.id))) {
    nodes.set(primitive.id, node(primitive));
  }

  for (const relation of [...transfer.relations].sort((a, b) => a.id.localeCompare(b.id))) {
    const subject = nodes.get(relation.source_id);
    if (subject === undefined) continue;
    const term = edgeTerm(relation);
    const existing = Array.isArray(subject[term]) ? (subject[term] as unknown[]) : [];
    const objectIri = relation.field_values["objectIri"];
    const target = typeof objectIri === "string" ? objectIri : relation.target_id;
    subject[term] = [...existing, { "@id": target }];
  }

  const document = {
    "@context": JSONLD_CONTEXT,
    "@graph": [...nodes.values()],
  };
  return new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
}

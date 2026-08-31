// ---------------------------------------------------------------------------
// vocabulary -- closed enumerations the media profile is built from.
//
// Every set here is closed and versioned: adding a value is a minor profile
// bump, removing one is major. The identifier registry is the load-bearing
// table -- each scheme declares the FRBR layer it addresses and the syntax it
// accepts, which is what lets the host reject an ISRC filed against an album
// instead of leaving it to a code review.
// ---------------------------------------------------------------------------

/** Profile identity, as registered with the host. */
export const PROFILE_ID = "profile:media:1.0" as const;

/** Profile semver. Literal so the version is readable from the schema alone. */
export const PROFILE_VERSION = "0.2.0" as const;

/** Schema version stamped on every record this profile validates. */
export const SCHEMA_VERSION = "1.0.0" as const;

/** FRBR layers, outermost first: a work is realized, embodied, then carried. */
export const LAYERS = ["work", "expression", "manifestation", "asset"] as const;
export type Layer = (typeof LAYERS)[number];

/** Layers an identifier scheme may address, including the two that are not FRBR layers. */
export const IDENTIFIER_LAYERS = ["agent", ...LAYERS, "unspecified"] as const;
export type IdentifierLayer = (typeof IDENTIFIER_LAYERS)[number];

/**
 * Epistemic status of an asserted value.
 *
 * `fact` is externally verifiable, `claim` is attributed to a source,
 * `inference` is machine-derived and carries confidence, `editorial` is a
 * house judgement.
 */
export const ASSERTION_KINDS = ["fact", "claim", "inference", "editorial"] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

/** PROV-O activity that produced a record. */
export const PROVENANCE_ACTIVITIES = [
  "ingest",
  "merge",
  "manualEdit",
  "inference",
  "import",
] as const;

/**
 * Association predicates. Composition stays a foreign key; these are the
 * edges that cross ownership boundaries and carry their own provenance.
 */
export const RELATION_PREDICATES = [
  // Derivation between works and expressions
  "adaptationOf",
  "translationOf",
  "abridgementOf",
  "revisionOf",
  "remixOf",
  "coverOf",
  "samples",
  "derivedFrom",
  // Bibliographic
  "cites",
  "hasVersion",
  "replaces",
  // Aggregation that is not composition
  "partOf",
  "memberOfCollection",
  // Social (ActivityStreams)
  "inReplyTo",
  "quoteOf",
  "repostOf",
  "attributedTo",
  "mentions",
  // Audiovisual and music
  "soundtrackFor",
  "trailerFor",
  "performanceOf",
  "recordingOf",
  "sameAs",
] as const;
export type RelationPredicate = (typeof RELATION_PREDICATES)[number];

/**
 * Predicates whose graphs must stay acyclic.
 *
 * No schema language expresses graph topology, so this list is the input to
 * {@link validateAcyclic} rather than a declaration the meta-model enforces.
 */
export const ACYCLIC_PREDICATES = [
  "partOf",
  "inReplyTo",
  "derivedFrom",
  "adaptationOf",
  "translationOf",
  "abridgementOf",
  "revisionOf",
  "hasVersion",
  "replaces",
] as const;

/**
 * Maximum traversal depth on predicates that tolerate cycles.
 *
 * `remixOf`, `coverOf` and `samples` can legitimately be mutual -- two artists
 * sampling each other is a fact, not a data error -- so they are bounded by
 * depth rather than forbidden.
 */
export const MAX_CYCLIC_DEPTH = 12;

/**
 * Predicates whose inverse is implied and must never be stored as a second edge.
 *
 * `cites`/`citedBy` and `partOf`/`hasPart` are one fact each. Persisting both
 * directions creates two records that can disagree.
 */
export const INVERSE_PREDICATES: Readonly<Record<string, string>> = {
  cites: "isCitedBy",
  partOf: "hasPart",
  hasVersion: "isVersionOf",
  replaces: "isReplacedBy",
};

/** Scheme token reserved for a registry this profile does not enumerate. */
export const OTHER_SCHEME = "other" as const;

/** Syntax of a namespaced scheme name supplied alongside {@link OTHER_SCHEME}. */
export const OTHER_SCHEME_NAME_PATTERN = /^[a-z][a-z0-9]*:[a-zA-Z][a-zA-Z0-9_-]*$/;

/** One external identifier registry: its syntax and the layer it addresses. */
export interface IdentifierScheme {
  /** Scheme token, as stored in `field_values.scheme`. */
  scheme: string;
  /** Human-readable registry name. */
  label: string;
  /** Anchored, non-global syntax check for the identifier's value. */
  pattern: RegExp;
  /** FRBR layer the registry addresses, or `unspecified` when the registrant chooses. */
  layer: IdentifierLayer;
  /** A value the registry accepts; asserted in tests so the pattern stays honest. */
  validSample: string;
  /** A value the registry rejects; asserted in tests so the pattern is not vacuous. */
  invalidSample: string;
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/**
 * Identifier registries this profile understands.
 *
 * A scheme whose `layer` is `unspecified` declares nothing about the layer:
 * a DOI may name a work, a version, or a dataset at the registrant's
 * discretion, so consumers must not assume one.
 */
export const IDENTIFIER_SCHEMES: readonly IdentifierScheme[] = [
  // Agents
  {
    scheme: "orcid",
    label: "ORCID",
    pattern: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/,
    layer: "agent",
    validSample: "0000-0002-1825-0097",
    invalidSample: "0000-0002-1825",
  },
  {
    scheme: "isni",
    label: "ISNI",
    pattern: /^\d{15}[\dX]$/,
    layer: "agent",
    validSample: "0000000121032683",
    invalidSample: "000000012103268",
  },
  {
    scheme: "wikidata",
    label: "Wikidata",
    pattern: /^Q\d+$/,
    layer: "unspecified",
    validSample: "Q42",
    invalidSample: "42",
  },
  // Music
  {
    scheme: "iswc",
    label: "ISWC",
    pattern: /^T-?\d{3}\.?\d{3}\.?\d{3}-?\d$/,
    layer: "work",
    validSample: "T-034.524.680-1",
    invalidSample: "T-034",
  },
  {
    scheme: "isrc",
    label: "ISRC",
    pattern: /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/,
    layer: "expression",
    validSample: "USRC17607839",
    invalidSample: "usrc17607839",
  },
  {
    scheme: "mbReleaseGroup",
    label: "MusicBrainz release group",
    pattern: new RegExp(`^${UUID}$`),
    layer: "work",
    validSample: "f27ec8db-af05-4f36-916e-3d57f91ecf5e",
    invalidSample: "not-a-uuid",
  },
  {
    scheme: "mbRecording",
    label: "MusicBrainz recording",
    pattern: new RegExp(`^${UUID}$`),
    layer: "expression",
    validSample: "f27ec8db-af05-4f36-916e-3d57f91ecf5e",
    invalidSample: "not-a-uuid",
  },
  {
    scheme: "mbRelease",
    label: "MusicBrainz release",
    pattern: new RegExp(`^${UUID}$`),
    layer: "manifestation",
    validSample: "f27ec8db-af05-4f36-916e-3d57f91ecf5e",
    invalidSample: "not-a-uuid",
  },
  {
    scheme: "upcEan",
    label: "UPC / EAN",
    pattern: /^\d{12,14}$/,
    layer: "manifestation",
    validSample: "602517166943",
    invalidSample: "12345",
  },
  // Audiovisual
  {
    scheme: "imdb",
    label: "IMDb",
    pattern: /^(tt|nm|co)\d{7,10}$/,
    layer: "unspecified",
    validSample: "tt0111161",
    invalidSample: "tt111",
  },
  {
    scheme: "tmdb",
    label: "TMDB",
    pattern: /^(movie|tv|person|episode):\d+$/,
    layer: "unspecified",
    validSample: "movie:278",
    invalidSample: "film:278",
  },
  {
    scheme: "eidr",
    label: "EIDR",
    pattern: /^10\.5240\/([0-9A-F]{4}-){5}[0-9A-Z]$/,
    layer: "expression",
    validSample: "10.5240/7791-8534-2C23-9030-8610-5",
    invalidSample: "10.5240/xyz",
  },
  // Text and scholarship
  {
    scheme: "isbn13",
    label: "ISBN-13",
    pattern: /^\d{13}$/,
    layer: "manifestation",
    validSample: "9780306406157",
    invalidSample: "0306406152",
  },
  {
    scheme: "issn",
    label: "ISSN",
    pattern: /^\d{4}-\d{3}[\dX]$/,
    layer: "work",
    validSample: "0028-0836",
    invalidSample: "0028",
  },
  {
    scheme: "doi",
    label: "DOI",
    pattern: /^10\.\d{4,9}\/\S+$/,
    layer: "unspecified",
    validSample: "10.1000/182",
    invalidSample: "doi:10.1000",
  },
  {
    scheme: "pmid",
    label: "PubMed",
    pattern: /^\d{1,9}$/,
    layer: "expression",
    validSample: "10534734",
    invalidSample: "PMID10534734",
  },
  // Platform-native
  {
    scheme: "youtubeVideo",
    label: "YouTube video",
    pattern: /^[A-Za-z0-9_-]{11}$/,
    layer: "manifestation",
    validSample: "dQw4w9WgXcQ",
    invalidSample: "short",
  },
  {
    scheme: "youtubeChannel",
    label: "YouTube channel",
    pattern: /^UC[A-Za-z0-9_-]{22}$/,
    layer: "agent",
    validSample: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
    invalidSample: "UCshort",
  },
  {
    scheme: "spotify",
    label: "Spotify URI",
    pattern: /^spotify:(track|album|artist|episode|show):[A-Za-z0-9]{22}$/,
    layer: "unspecified",
    validSample: "spotify:track:6rqhFgbbKwnb9MLmUQDhG6",
    invalidSample: "spotify:track:short",
  },
  {
    scheme: "atprotoUri",
    label: "AT Protocol URI",
    pattern: /^at:\/\/\S+$/,
    layer: "manifestation",
    validSample: "at://did:plc:z72i7hd/app.bsky.feed.post/3k",
    invalidSample: "https://bsky.app/profile/x",
  },
  {
    scheme: "activityPubIri",
    label: "ActivityPub IRI",
    pattern: /^https?:\/\/\S+$/,
    layer: "manifestation",
    validSample: "https://mastodon.social/users/x/statuses/1",
    invalidSample: "mastodon.social/users/x",
  },
];

const SCHEMES_BY_NAME = new Map(IDENTIFIER_SCHEMES.map((s) => [s.scheme, s]));

/**
 * Look up an identifier registry by its scheme token.
 *
 * @param scheme - Scheme token as stored in `field_values.scheme`.
 * @returns The registry descriptor, or `undefined` when the token is unknown.
 */
export function schemeByName(scheme: string): IdentifierScheme | undefined {
  return SCHEMES_BY_NAME.get(scheme);
}

/** Every scheme token the profile's `scheme` enum accepts, escape hatch last. */
export const SCHEME_TOKENS: readonly string[] = [
  ...IDENTIFIER_SCHEMES.map((s) => s.scheme),
  OTHER_SCHEME,
];

/** BCP 47 language tag, constrained to the subtags this profile stores. */
export const BCP47_PATTERN = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/;

/** RFC 3339 instant, normalized to UTC. */
export const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** EDTF level-0 partial date: year, year-month, or full date. */
export const EDTF_PATTERN = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/** Lowercase SHA-256 digest, prefixed with its algorithm. */
export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

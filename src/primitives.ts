// ---------------------------------------------------------------------------
// primitives -- the type inventory, laid out on the four FRBR layers.
//
// work          the abstract creation      a composition, a novel, a film
// expression    a realization              a recording, a translation, a cut
// manifestation a published embodiment     a release, an edition, a post
// asset         one retrievable stream     a FLAC file, an MP4, a WebVTT track
//
// The layer is a pinned enum on every resource type and the type id is the
// discriminator, so a track cannot be typed as a work.
// ---------------------------------------------------------------------------

import type { FieldDefT, PrimitiveTypeDef } from "@fdpm/cli";
import {
  choice,
  decimal,
  extensionPoint,
  flag,
  instant,
  integer,
  iri,
  item,
  list,
  locale,
  longText,
  partialDate,
  pinned,
  ref,
  struct,
  structItem,
  text,
} from "./fields.js";
import {
  CARRIER,
  CORRECTION,
  LOCALIZED_TEXT,
  METRICS_SNAPSHOT,
  PROVENANCE,
  RATING,
  RIGHTS,
} from "./structs.js";
import {
  IDENTIFIER_LAYERS,
  SCHEMA_VERSION,
  SCHEME_TOKENS,
  SHA256_PATTERN,
  type Layer,
} from "./vocabulary.js";

/** Conceptual buckets the type inventory is grouped into. */
export const CATEGORIES = [
  {
    id: "cat:media:work",
    name: "Works",
    description: "Abstract creations, before any realization.",
  },
  {
    id: "cat:media:expression",
    name: "Expressions",
    description: "Realizations of a work: a recording, a translation, a cut.",
  },
  {
    id: "cat:media:manifestation",
    name: "Manifestations",
    description: "Published embodiments: releases, editions, articles, posts.",
  },
  {
    id: "cat:media:asset",
    name: "Assets",
    description: "Retrievable byte streams and the collections that group them.",
  },
  {
    id: "cat:media:agent",
    name: "Agents",
    description: "People and organizations that create, publish or distribute.",
  },
  {
    id: "cat:media:description",
    name: "Description",
    description: "Identifiers, controlled vocabulary and provider records.",
  },
  {
    id: "cat:media:annotation",
    name: "Annotations",
    description: "Statements attached to a resource or to a fragment of one.",
  },
] as const;

/** Partition units for id uniqueness within a workbook. */
export const SCOPES = [
  {
    id: "scope:media:catalogue",
    name: "Catalogue",
    rank: 1,
    description: "Workbook-level scope; every media record lives here by default.",
  },
  {
    id: "scope:media:collection",
    name: "Collection",
    rank: 2,
    description:
      "Curated subset within a catalogue, so the same local identifier may recur across collections.",
  },
] as const;

/** Record envelope carried by every type: version, provenance, extension point. */
function envelope(): FieldDefT[] {
  return [
    text("schemaVersion", "Version of the media schema this record conforms to.", 20, {
      required: true,
      ann: { immutable: true },
      pattern: /^\d+\.\d+\.\d+$/,
    }),
    struct("provenance", "Who produced this record, from where, and when.", PROVENANCE, {
      required: true,
    }),
    extensionPoint(
      "extensions",
      "Namespaced payloads this profile does not model. An unrecognized namespace is data this deployment does not model yet, not an error.",
    ),
  ];
}

/** Descriptive metadata every resource carries, whatever its layer. */
function descriptive(): FieldDefT[] {
  return [
    struct("title", "Title of the resource.", LOCALIZED_TEXT, {
      required: true,
      ann: { localization: "locale-map" },
    }),
    struct("subtitle", "Secondary title, where the source distinguishes one.", LOCALIZED_TEXT, {
      ann: { localization: "locale-map" },
    }),
    list(
      "alternativeTitles",
      "Other titles the resource is known by.",
      structItem(LOCALIZED_TEXT),
      "insignificant",
      20,
      { ann: { localization: "locale-map" } },
    ),
    text("sortTitle", "Title normalized for sorting, with leading articles removed.", 300),
    struct("summary", "Short description of the resource.", LOCALIZED_TEXT, {
      ann: { localization: "locale-map" },
    }),
    list(
      "languages",
      "Content languages, most prominent first.",
      item("string", 35),
      "significant",
      20,
    ),
    list("keywords", "Free-text subject terms.", item("string", 120), "insignificant", 50),
    struct("rights", "Licensing and distribution terms.", RIGHTS),
  ];
}

/** Assemble one resource type sitting at a declared FRBR layer. */
function resource(args: {
  id: string;
  name: string;
  layer: Layer;
  description: string;
  idPattern: string;
  fields: FieldDefT[];
}): PrimitiveTypeDef {
  const categoryByLayer: Record<Layer, string> = {
    work: "cat:media:work",
    expression: "cat:media:expression",
    manifestation: "cat:media:manifestation",
    asset: "cat:media:asset",
  };
  return {
    id: args.id,
    name: args.name,
    category_id: categoryByLayer[args.layer],
    description: args.description,
    scoped: true,
    is_partition_unit: false,
    id_format: { pattern: args.idPattern, uniqueness: "workbook", pattern_kind: "regex" },
    inline_structs: [],
    constraints: [],
    fields: [
      pinned("layer", `FRBR layer this type sits at.`, args.layer),
      ...envelope(),
      ...descriptive(),
      ...args.fields,
    ],
  };
}

/** Assemble one supporting type that sits outside the FRBR layering. */
function supporting(args: {
  id: string;
  name: string;
  category: string;
  description: string;
  idPattern: string;
  fields: FieldDefT[];
}): PrimitiveTypeDef {
  return {
    id: args.id,
    name: args.name,
    category_id: args.category,
    description: args.description,
    scoped: true,
    is_partition_unit: false,
    id_format: { pattern: args.idPattern, uniqueness: "workbook", pattern_kind: "regex" },
    inline_structs: [],
    constraints: [],
    fields: [...envelope(), ...args.fields],
  };
}

const WORK_ID = "^work:[a-z0-9][a-z0-9._-]*$";
const EXPRESSION_ID = "^expression:[a-z0-9][a-z0-9._-]*$";
const MANIFESTATION_ID = "^manifestation:[a-z0-9][a-z0-9._-]*$";
const ASSET_ID = "^asset:[a-z0-9][a-z0-9._-]*$";

// -- work layer -----------------------------------------------------------

const MUSIC_COMPOSITION = resource({
  id: "media:MusicComposition",
  name: "Music composition",
  layer: "work",
  description:
    "A musical work as composed, before any performance of it. Registered by ISWC; distinct from every recording that realizes it.",
  idPattern: WORK_ID,
  fields: [
    partialDate("createdDate", "When the work was composed, to whatever precision is known."),
    flag("isPublicDomain", "Whether the composition has entered the public domain.", false),
    text("opusNumber", "Catalogue number assigned by the composer or a cataloguer.", 60),
  ],
});

const LITERARY_WORK = resource({
  id: "media:LiteraryWork",
  name: "Literary work",
  layer: "work",
  description:
    "A written work as authored, independent of the editions that publish it and the translations that realize it.",
  idPattern: WORK_ID,
  fields: [
    partialDate("createdDate", "When the work was written, to whatever precision is known."),
    locale("originalLanguage", "Language the work was composed in."),
    struct("seriesTitle", "Series the work belongs to.", LOCALIZED_TEXT, {
      ann: { localization: "locale-map" },
    }),
    integer("seriesPosition", "Position within the series.", "ordinal", { min: 1 }),
  ],
});

const MOVIE_WORK = resource({
  id: "media:MovieWork",
  name: "Film work",
  layer: "work",
  description:
    "A film as conceived, distinct from any particular cut of it and from the releases that carry those cuts.",
  idPattern: WORK_ID,
  fields: [
    partialDate("createdDate", "When production concluded, to whatever precision is known."),
    list(
      "originCountries",
      "ISO 3166-1 alpha-2 codes of the countries of origin.",
      item("string", 2),
      "significant",
      20,
    ),
  ],
});

const TV_SERIES_WORK = resource({
  id: "media:TvSeriesWork",
  name: "Television series",
  layer: "work",
  description:
    "A television series as a whole. Seasons and episodes attach to it through partOf edges rather than being nested inside it.",
  idPattern: WORK_ID,
  fields: [
    partialDate("createdDate", "When the series was first produced."),
    integer("seasonCount", "Seasons produced.", "count", { min: 0 }),
  ],
});

const PODCAST_SERIES_WORK = resource({
  id: "media:PodcastSeriesWork",
  name: "Podcast series",
  layer: "work",
  description: "A podcast as a continuing series, distinct from the episodes published under it.",
  idPattern: WORK_ID,
  fields: [
    partialDate("createdDate", "When the series began."),
    iri("feedIri", "Canonical RSS or Atom feed for the series."),
  ],
});

// -- expression layer -----------------------------------------------------

const MUSIC_RECORDING = resource({
  id: "media:MusicRecording",
  name: "Music recording",
  layer: "expression",
  description:
    "One recorded performance of a composition. Identified by ISRC, and the thing a track on a release points at.",
  idPattern: EXPRESSION_ID,
  fields: [
    ref(
      "compositionId",
      "Composition this recording realizes.",
      "media:MusicComposition",
      "composition",
      {
        required: true,
      },
    ),
    decimal("duration", "Running time of the recording.", "seconds", { min: 0 }),
    flag("isLive", "Whether the recording captures a live performance.", false),
    flag("isRemix", "Whether the recording is a remix of another.", false),
    flag("isExplicit", "Whether the recording carries an explicit-content advisory.", false),
    decimal("bpm", "Tempo of the recording.", "beatsPerMinute", { min: 1, max: 400 }),
    text("musicalKey", "Key the recording is performed in.", 40),
    partialDate("recordedAt", "When the recording was made."),
  ],
});

const TEXT_EXPRESSION = resource({
  id: "media:TextExpression",
  name: "Text expression",
  layer: "expression",
  description:
    "The text of one translation, revision or abridgement of a literary work. An expression, not a product: it has no ISBN.",
  idPattern: EXPRESSION_ID,
  fields: [
    ref(
      "literaryWorkId",
      "Literary work this text realizes.",
      "media:LiteraryWork",
      "composition",
      {
        required: true,
      },
    ),
    choice(
      "expressionKind",
      "How this text relates to the work it realizes.",
      ["original", "translation", "abridgement", "revision", "adaptation"],
      { required: true },
    ),
    integer("wordCount", "Length of the text, where it has been measured.", "words", { min: 0 }),
  ],
});

const AV_CUT = resource({
  id: "media:AvCut",
  name: "Audiovisual cut",
  layer: "expression",
  description:
    "One edit of a film or episode: theatrical, extended, or a broadcast edit. Carries the authoritative runtime.",
  idPattern: EXPRESSION_ID,
  fields: [
    ref("movieWorkId", "Film or episode this cut realizes.", "media:MovieWork", "composition", {
      required: true,
    }),
    choice(
      "cutKind",
      "Which edit this is.",
      ["theatrical", "extended", "directors", "broadcast", "unrated", "other"],
      { required: true },
    ),
    decimal("duration", "Authoritative runtime of this cut.", "seconds", { min: 0 }),
  ],
});

// -- manifestation layer --------------------------------------------------

/** Fields shared by everything published: when, by whom, and under what IRI. */
function published(): FieldDefT[] {
  return [
    instant("publishedAt", "Exact publication instant, where the source records one."),
    partialDate("publicationDate", "Publication date to whatever precision is known."),
    iri("canonicalIri", "Canonical location of the published item."),
  ];
}

const MUSIC_RELEASE = resource({
  id: "media:MusicRelease",
  name: "Music release",
  layer: "manifestation",
  description:
    "An album, single or compilation as published: a product with a barcode, a catalogue number and a track listing.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    choice(
      "releaseType",
      "MusicBrainz primary type of the release.",
      ["album", "single", "ep", "compilation", "soundtrack", "live", "remix", "other"],
      { required: true },
    ),
    choice(
      "releaseStatus",
      "Whether the release was officially issued.",
      ["official", "promotion", "bootleg", "pseudoRelease"],
      { default: "official" },
    ),
    text("catalogNumber", "Label catalogue number printed on the release.", 80),
    text("releaseCountry", "ISO 3166-1 alpha-2 code of the release territory.", 2),
    list(
      "carriers",
      "Physical or digital media making up the release, in disc order.",
      structItem(CARRIER),
      "significant",
      50,
    ),
  ],
});

const MUSIC_TRACK = resource({
  id: "media:MusicTrack",
  name: "Music track",
  layer: "manifestation",
  description:
    "The placement of a recording on a release. Separate from the recording because one recording appears on many releases, at different positions and sometimes under a different title.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    ref("releaseId", "Release this track appears on.", "media:MusicRelease", "composition", {
      required: true,
    }),
    ref(
      "recordingExpressionId",
      "Recording this track places.",
      "media:MusicRecording",
      "aggregation",
      { required: true },
    ),
    integer("mediumPosition", "Which carrier of the release the track sits on.", "ordinal", {
      min: 1,
    }),
    integer("trackPosition", "Position within the carrier.", "ordinal", {
      required: true,
      min: 1,
    }),
    decimal("duration", "Running time as printed on the release.", "seconds", { min: 0 }),
  ],
});

const BOOK_EDITION = resource({
  id: "media:BookEdition",
  name: "Book edition",
  layer: "manifestation",
  description:
    "A published book product: ISBN, format, imprint and pagination. Maps to an ONIX Product.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    choice(
      "bookFormat",
      "Product format.",
      ["hardcover", "paperback", "ebook", "audiobook", "graphicNovel", "other"],
      { required: true },
    ),
    text("editionStatement", "Edition as stated on the title page.", 200),
    integer("pageCount", "Extent of the printed edition.", "pages", { min: 1 }),
    decimal("duration", "Running time of the audiobook edition.", "seconds", { min: 0 }),
    text(
      "onixProductFormCode",
      "ONIX product form code, preserved verbatim because it is finer than bookFormat.",
      2,
      { pattern: /^[A-Z]{2}$/ },
    ),
  ],
});

/** Fields shared by editorial items whose body text is captured. */
function editorial(): FieldDefT[] {
  return [
    text(
      "bodyHash",
      "Digest of the body text at capture time. Text-position anchors are valid only against it.",
      80,
      { pattern: SHA256_PATTERN },
    ),
    longText("bodyText", "Body text as captured.", 400000),
    integer("wordCount", "Length of the body text.", "words", { min: 0 }),
  ];
}

const NEWS_ARTICLE = resource({
  id: "media:NewsArticle",
  name: "News article",
  layer: "manifestation",
  description:
    "An article as published by an outlet, with the IPTC workflow state that governs whether it may be shown.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    ...editorial(),
    ref("outletAgentId", "Outlet that published the article.", "media:Agent", "aggregation", {
      required: true,
    }),
    text("section", "Section the article was filed under.", 120),
    text("dateline", "Dateline as printed.", 200),
    choice("pubStatus", "IPTC publication status.", ["usable", "withheld", "canceled"], {
      default: "usable",
    }),
    integer("urgency", "IPTC urgency, 1 most urgent to 9 least.", "iptcUrgency", {
      min: 1,
      max: 9,
    }),
    flag("isPaywalled", "Whether the article sits behind a paywall.", false),
    list(
      "corrections",
      "Corrections published against the article.",
      structItem(CORRECTION),
      "significant",
      50,
    ),
  ],
});

const SCHOLARLY_ARTICLE = resource({
  id: "media:ScholarlyArticle",
  name: "Scholarly article",
  layer: "manifestation",
  description:
    "A peer-reviewed article as published in a journal or proceedings, cited through DOI or PMID.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    ...editorial(),
    struct("containerTitle", "Journal or proceedings the article appeared in.", LOCALIZED_TEXT, {
      required: true,
      ann: { localization: "locale-map" },
    }),
    text("volume", "Volume designation.", 40),
    text("issue", "Issue designation.", 40),
    integer("startPage", "First page of the article.", "pages", { min: 1 }),
    integer("endPage", "Last page of the article.", "pages", { min: 1 }),
  ],
});

const VIDEO_PUBLICATION = resource({
  id: "media:VideoPublication",
  name: "Video publication",
  layer: "manifestation",
  description:
    "A video as published on a platform, carrying that platform's own counts as timestamped snapshots.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    choice(
      "videoPlatform",
      "Platform the video is published on.",
      ["youtube", "vimeo", "twitch", "tiktok", "peertube", "other"],
      { required: true },
    ),
    ref("channelAgentId", "Channel that published the video.", "media:Agent", "aggregation", {
      required: true,
    }),
    decimal("duration", "Running time of the published video.", "seconds", {
      required: true,
      min: 0,
    }),
    flag("isLiveBroadcast", "Whether the item is or was a live broadcast.", false),
    struct("metricsSnapshot", "Platform counts as last observed.", METRICS_SNAPSHOT),
  ],
});

const PODCAST_EPISODE = resource({
  id: "media:PodcastEpisode",
  name: "Podcast episode",
  layer: "manifestation",
  description: "One published episode of a podcast series, with its enclosure and running time.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    ref(
      "seriesWorkId",
      "Series this episode belongs to.",
      "media:PodcastSeriesWork",
      "composition",
      { required: true },
    ),
    integer("episodeNumber", "Position within the series or season.", "ordinal", { min: 1 }),
    integer("seasonNumber", "Season the episode belongs to.", "ordinal", { min: 1 }),
    decimal("duration", "Running time of the episode.", "seconds", { min: 0 }),
    flag("isExplicit", "Whether the episode carries an explicit-content advisory.", false),
  ],
});

const SOCIAL_POST = resource({
  id: "media:SocialPost",
  name: "Social post",
  layer: "manifestation",
  description:
    "A post on a social platform. Replies, quotes and reposts relate to their antecedent through edges, following ActivityStreams rather than nesting.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    choice(
      "socialPlatform",
      "Platform the post was published on.",
      ["twitter", "bluesky", "mastodon", "threads", "reddit", "linkedin", "other"],
      { required: true },
    ),
    ref("authorAgentId", "Account that published the post.", "media:Agent", "aggregation", {
      required: true,
    }),
    longText("bodyText", "Body text as captured.", 400000),
    choice(
      "asObjectType",
      "ActivityStreams object type of the post.",
      ["Note", "Article", "Image", "Video", "Audio", "Question", "Page"],
      { default: "Note" },
    ),
    choice(
      "postKind",
      "Whether the post is original or derives from another.",
      ["original", "reply", "repost", "quote"],
      { required: true },
    ),
    flag("isSensitive", "Whether the platform flagged the post as sensitive.", false),
    struct("metricsSnapshot", "Platform counts as last observed.", METRICS_SNAPSHOT),
    {
      ...instant("deletedAt", "When the post was deleted. Explicitly cleared while it stands."),
      nullable: true,
    },
  ],
});

const COMMENT = resource({
  id: "media:Comment",
  name: "Comment",
  layer: "manifestation",
  description:
    "User commentary attached to another resource. Threading runs through inReplyTo edges, which are held acyclic.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    ref("authorAgentId", "Account that wrote the comment.", "media:Agent", "aggregation", {
      required: true,
    }),
    longText("bodyText", "Body text as captured.", 400000, { required: true }),
    {
      ...instant("deletedAt", "When the comment was deleted. Explicitly cleared while it stands."),
      nullable: true,
    },
  ],
});

const REVIEW = resource({
  id: "media:Review",
  name: "Review",
  layer: "manifestation",
  description:
    "An evaluative judgement of another resource, carrying the scale its score was given on.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    ref("authorAgentId", "Account that wrote the review.", "media:Agent", "aggregation", {
      required: true,
    }),
    longText("bodyText", "Body text as captured.", 400000),
    struct("rating", "Score awarded, with the scale it was given on.", RATING),
  ],
});

const COMPONENT_PART = resource({
  id: "media:ComponentPart",
  name: "Component part",
  layer: "manifestation",
  description:
    "A chapter, scene, movement or segment: a structural division of a manifestation, addressable in its own right.",
  idPattern: MANIFESTATION_ID,
  fields: [
    ...published(),
    choice(
      "componentKind",
      "What kind of division this is.",
      ["chapter", "section", "scene", "movement", "act", "segment"],
      { required: true },
    ),
    integer("ordinal", "Position within the parent, counting from one.", "ordinal", {
      required: true,
      min: 1,
    }),
    decimal("startTime", "Offset at which the part begins.", "seconds", { min: 0 }),
    decimal("endTime", "Offset at which the part ends.", "seconds", { min: 0 }),
    integer("startPage", "First page of the part.", "pages", { min: 1 }),
    integer("endPage", "Last page of the part.", "pages", { min: 1 }),
  ],
});

// -- asset layer ----------------------------------------------------------

/** Fields shared by every retrievable byte stream. */
function assetCore(): FieldDefT[] {
  return [
    iri("contentIri", "Where the byte stream is retrieved from.", { required: true }),
    text("mediaType", "IANA media type of the stream.", 160, {
      required: true,
      pattern: /^[a-z]+\/[a-zA-Z0-9.+-]+$/,
    }),
    integer("byteSize", "Size of the stream.", "bytes", { min: 0 }),
    text("contentHash", "Digest of the stream, for integrity and for anchoring annotations.", 80, {
      pattern: SHA256_PATTERN,
    }),
  ];
}

const IMAGE_ASSET = resource({
  id: "media:ImageAsset",
  name: "Image asset",
  layer: "asset",
  description: "One image file, with the pixel dimensions and the role it plays for its resource.",
  idPattern: ASSET_ID,
  fields: [
    ...assetCore(),
    integer("widthPx", "Width of the image.", "pixels", { required: true, min: 1 }),
    integer("heightPx", "Height of the image.", "pixels", { required: true, min: 1 }),
    struct("altText", "Alternative text describing the image.", LOCALIZED_TEXT, {
      ann: { localization: "locale-map" },
    }),
    choice(
      "imageRole",
      "What the image is used for.",
      ["cover", "thumbnail", "still", "illustration", "avatar", "poster", "other"],
      { required: true },
    ),
  ],
});

const AUDIO_ASSET = resource({
  id: "media:AudioAsset",
  name: "Audio asset",
  layer: "asset",
  description: "One audio file, with the EBUCore technical characteristics of the stream.",
  idPattern: ASSET_ID,
  fields: [
    ...assetCore(),
    decimal("duration", "Running time of the stream.", "seconds", { required: true, min: 0 }),
    integer("bitrateBps", "Encoded bitrate.", "bitsPerSecond", { min: 1 }),
    integer("sampleRateHz", "Sampling rate.", "hertz", { min: 1 }),
    integer("channelCount", "Audio channels carried.", "count", { min: 1, max: 64 }),
    locale("audioLanguage", "Language spoken or sung on the stream."),
  ],
});

const VIDEO_ASSET = resource({
  id: "media:VideoAsset",
  name: "Video asset",
  layer: "asset",
  description: "One video file, with the EBUCore technical characteristics of the stream.",
  idPattern: ASSET_ID,
  fields: [
    ...assetCore(),
    decimal("duration", "Running time of the stream.", "seconds", { required: true, min: 0 }),
    integer("widthPx", "Frame width.", "pixels", { required: true, min: 1 }),
    integer("heightPx", "Frame height.", "pixels", { required: true, min: 1 }),
    decimal(
      "frameRateFps",
      "Frames displayed per second, as encoded. Broadcast rates are fractional, so this is not an integer.",
      "framesPerSecond",
      { min: 0.1, max: 1000 },
    ),
    integer("bitrateBps", "Encoded bitrate.", "bitsPerSecond", { min: 1 }),
  ],
});

const TEXT_ASSET = resource({
  id: "media:TextAsset",
  name: "Text asset",
  layer: "asset",
  description:
    "One text stream: a transcript, a caption track, or a full-text rendition. The anchor surface for text and time selectors.",
  idPattern: ASSET_ID,
  fields: [
    ...assetCore(),
    choice(
      "textRole",
      "What the text stream carries.",
      ["transcript", "captions", "subtitles", "fullText", "lyrics", "other"],
      { required: true },
    ),
    locale("textLanguage", "Language the text is written in."),
    flag("isMachineGenerated", "Whether the text was produced automatically.", false),
    integer("cueCount", "Time-aligned cues the stream contains.", "count", { min: 0 }),
  ],
});

// -- supporting types -----------------------------------------------------

const AGENT = supporting({
  id: "media:Agent",
  name: "Agent",
  category: "cat:media:agent",
  description:
    "A person, organization, group or account that creates, publishes or distributes. Birth and death dates identify a natural person and are classified accordingly.",
  idPattern: "^agent:[a-z0-9][a-z0-9._-]*$",
  fields: [
    text("name", "Name as most commonly rendered.", 300, { required: true }),
    text("sortName", "Name normalized for sorting, surname first.", 300),
    choice(
      "agentKind",
      "What kind of agent this is.",
      ["person", "organization", "group", "software", "pseudonym"],
      { required: true },
    ),
    partialDate("birthDate", "Date of birth.", { ann: { sensitivity: "pii" } }),
    partialDate("deathDate", "Date of death.", { ann: { sensitivity: "pii" } }),
    text("countryCode", "ISO 3166-1 alpha-2 code the agent is associated with.", 2),
    iri("homepageIri", "Canonical page for the agent."),
  ],
});

const IDENTIFIER = supporting({
  id: "media:Identifier",
  name: "Identifier",
  category: "cat:media:description",
  description:
    "One external registry identifier attached to one record. A first-class type rather than an embedded list, so the host can check the registry's syntax and the layer it addresses against the record it names.",
  idPattern: "^identifier:[a-z0-9][a-z0-9._-]*$",
  fields: [
    choice("scheme", "Registry the identifier belongs to.", SCHEME_TOKENS, { required: true }),
    text("schemeName", 'Namespaced registry name, required when scheme is "other".', 120),
    text("value", "The identifier as issued by the registry.", 400, { required: true }),
    choice(
      "addressesLayer",
      "FRBR layer this registry addresses. Distinct from a record's own layer: a registry names one level of the model, and unspecified means the registrant chooses.",
      IDENTIFIER_LAYERS,
      { required: true },
    ),
    text("identifiesId", "Record this identifier names, at any layer.", 200, {
      required: true,
      ann: {
        fk: "*.id",
        relationship: "association",
        waiver:
          "rule 13 - a reference field names one target type and an identifier names any record; validateIdentifier resolves the referent and rejects a dangling or mislayered one",
      },
    }),
    iri("resolverIri", "Resolvable form of the identifier."),
  ],
});

const CONCEPT = supporting({
  id: "media:Concept",
  name: "Concept",
  category: "cat:media:description",
  description:
    "One term from a controlled vocabulary: a genre, an IPTC media topic, a Wikidata entity. Referenced by edges rather than copied into each resource.",
  idPattern: "^concept:[a-z0-9][a-z0-9._-]*$",
  fields: [
    choice(
      "vocabulary",
      "Vocabulary the term is drawn from.",
      ["iptcMediaTopic", "wikidata", "schemaOrgGenre", "musicbrainzGenre", "local", "other"],
      { required: true },
    ),
    text("code", "Term code as issued by the vocabulary.", 200, { required: true }),
    struct("label", "Human-readable label for the term.", LOCALIZED_TEXT, {
      required: true,
      ann: { localization: "locale-map" },
    }),
    iri("conceptIri", "Resolvable IRI for the term."),
  ],
});

const PROVIDER_RECORD = supporting({
  id: "media:ProviderRecord",
  name: "Provider record",
  category: "cat:media:description",
  description:
    "One provider's view of a record, kept verbatim alongside the canonical entity. Two providers that disagree produce two of these and one entity, and the disagreement stays inspectable.",
  idPattern: "^provider:[a-z0-9][a-z0-9._-]*$",
  fields: [
    text("provider", "Provider the record came from.", 120, { required: true }),
    text("describesId", "Canonical record this provider view describes, at any layer.", 200, {
      required: true,
      ann: {
        fk: "*.id",
        relationship: "association",
        waiver:
          "rule 13 - a reference field names one target type and a provider record describes any record; the sameAs edge carries the cross-provider claim that can be checked",
      },
    }),
    instant("retrievedAt", "When the provider document was fetched.", { required: true }),
    decimal("trustWeight", "Weight applied to this provider at merge time.", "weight", {
      required: true,
      min: 0,
      max: 1,
    }),
    extensionPoint(
      "rawPayload",
      "The provider's document, untouched, so an export can reproduce fields no part of this profile understands.",
      { required: true },
    ),
  ],
});

const COLLECTION = supporting({
  id: "media:Collection",
  name: "Collection",
  category: "cat:media:asset",
  description:
    "A curated set of resources: a playlist, a series bundle, a reading list. Membership runs through edges so a resource can belong to many.",
  idPattern: "^collection:[a-z0-9][a-z0-9._-]*$",
  fields: [
    struct("title", "Title of the collection.", LOCALIZED_TEXT, {
      required: true,
      ann: { localization: "locale-map" },
    }),
    struct("summary", "What the collection gathers.", LOCALIZED_TEXT, {
      ann: { localization: "locale-map" },
    }),
    choice(
      "collectionKind",
      "What kind of set this is.",
      ["playlist", "series", "boxSet", "readingList", "editorial", "other"],
      { required: true },
    ),
    flag("hasSignificantOrder", "Whether member order is part of the collection's meaning.", false),
    struct("rights", "Licensing and distribution terms.", RIGHTS),
  ],
});

const ANNOTATION = supporting({
  id: "media:Annotation",
  name: "Annotation",
  category: "cat:media:annotation",
  description:
    "A W3C Web Annotation: a statement attached to a whole resource or to a precise fragment of one. The selector kind discriminates which anchor fields apply.",
  idPattern: "^annotation:[a-z0-9][a-z0-9._-]*$",
  fields: [
    choice(
      "motivation",
      "Why the annotation was made, from the W3C motivation set.",
      [
        "assessing",
        "bookmarking",
        "classifying",
        "commenting",
        "describing",
        "editing",
        "highlighting",
        "identifying",
        "linking",
        "moderating",
        "questioning",
        "replying",
        "tagging",
      ],
      { required: true },
    ),
    choice(
      "selectorType",
      "How the annotation addresses its target. Determines which anchor fields below apply.",
      [
        "whole",
        "textQuote",
        "textPosition",
        "timeRange",
        "spatialRegion",
        "svg",
        "page",
        "epubCfi",
        "structural",
        "css",
      ],
      { required: true },
    ),
    choice(
      "bodyType",
      "What the annotation says about its target.",
      [
        "textual",
        "tagging",
        "entityLink",
        "claim",
        "citation",
        "sentiment",
        "moderation",
        "transcription",
        "resource",
      ],
      { required: true },
    ),
    struct("bodyValue", "Content of the annotation.", LOCALIZED_TEXT, {
      ann: { localization: "locale-map" },
    }),
    choice(
      "anchorStatus",
      "Whether the anchor still resolves against the target as it stands.",
      ["resolved", "approximate", "orphaned", "unverified"],
      { default: "unverified" },
    ),
    text("exactQuote", "Exact text the annotation covers.", 4000),
    text("prefixQuote", "Text immediately preceding the quote, for re-anchoring.", 1000),
    text("suffixQuote", "Text immediately following the quote, for re-anchoring.", 1000),
    integer("startOffset", "Start of the covered range.", "utf16CodeUnits", { min: 0 }),
    integer("endOffset", "End of the covered range.", "utf16CodeUnits", { min: 0 }),
    choice(
      "unicodeNormalization",
      "Normalization form the offsets were counted under. Offsets are meaningless without it.",
      ["NFC", "NFD", "NFKC", "NFKD"],
    ),
    text("sourceHash", "Digest of the target at anchoring time.", 80, { pattern: SHA256_PATTERN }),
    decimal("startTime", "Offset at which the covered range begins.", "seconds", { min: 0 }),
    decimal("endTime", "Offset at which the covered range ends.", "seconds", { min: 0 }),
    text("smpteStart", "Broadcast timecode of the start, carried alongside the float.", 20),
    text("smpteEnd", "Broadcast timecode of the end, carried alongside the float.", 20),
    decimal("regionX", "Left edge of the covered region.", "percent", { min: 0, max: 100 }),
    decimal("regionY", "Top edge of the covered region.", "percent", { min: 0, max: 100 }),
    decimal("regionWidth", "Width of the covered region.", "percent", { min: 0, max: 100 }),
    decimal("regionHeight", "Height of the covered region.", "percent", { min: 0, max: 100 }),
    integer("pageNumber", "Page the annotation sits on.", "ordinal", { min: 1 }),
    text("cfiRange", "EPUB canonical fragment identifier of the covered range.", 500),
    text("cssSelector", "CSS selector addressing the covered element.", 500),
    text("svgPath", "SVG path describing the covered region.", 4000),
    choice(
      "assertionKind",
      "Epistemic status of what the annotation asserts.",
      ["fact", "claim", "inference", "editorial"],
      { required: true },
    ),
    decimal(
      "confidence",
      "Confidence in the assertion. Required for an inference.",
      "probability",
      {
        min: 0,
        max: 1,
      },
    ),
    text("assertedBy", "Agent, model or system that made the assertion.", 200, { required: true }),
    instant("assertedAt", "When the assertion was made.", { required: true }),
    list(
      "evidenceIris",
      "Documents supporting the assertion.",
      item("string", 2048),
      "insignificant",
      50,
    ),
  ],
});

/** Every primitive type the profile declares. */
export const PRIMITIVE_TYPES: PrimitiveTypeDef[] = [
  MUSIC_COMPOSITION,
  LITERARY_WORK,
  MOVIE_WORK,
  TV_SERIES_WORK,
  PODCAST_SERIES_WORK,
  MUSIC_RECORDING,
  TEXT_EXPRESSION,
  AV_CUT,
  MUSIC_RELEASE,
  MUSIC_TRACK,
  BOOK_EDITION,
  NEWS_ARTICLE,
  SCHOLARLY_ARTICLE,
  VIDEO_PUBLICATION,
  PODCAST_EPISODE,
  SOCIAL_POST,
  COMMENT,
  REVIEW,
  COMPONENT_PART,
  IMAGE_ASSET,
  AUDIO_ASSET,
  VIDEO_ASSET,
  TEXT_ASSET,
  AGENT,
  IDENTIFIER,
  CONCEPT,
  PROVIDER_RECORD,
  COLLECTION,
  ANNOTATION,
];

/** Type ids grouped by the FRBR layer they sit at. */
export const TYPES_BY_LAYER: Record<Layer, string[]> = {
  work: layerMembers("work"),
  expression: layerMembers("expression"),
  manifestation: layerMembers("manifestation"),
  asset: layerMembers("asset"),
};

function layerMembers(layer: Layer): string[] {
  return PRIMITIVE_TYPES.filter(
    (t) => t.fields.find((f) => f.name === "layer")?.enum_values?.[0] === layer,
  ).map((t) => t.id);
}

/** Every resource type, across all four layers. */
export const RESOURCE_TYPE_IDS: string[] = [
  ...TYPES_BY_LAYER.work,
  ...TYPES_BY_LAYER.expression,
  ...TYPES_BY_LAYER.manifestation,
  ...TYPES_BY_LAYER.asset,
];

/** Schema version stamped on records this profile validates. */
export const RECORD_SCHEMA_VERSION = SCHEMA_VERSION;

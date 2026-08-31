# fdpm-plugin-media

An FDPM plugin contributing **`profile:media:1.0`** — a standards-aligned domain
profile for heterogeneous media (music, film, television, books, journalism,
scholarship, social posts, platform video) and for annotations attached to whole
resources or to precise fragments of them.

It is an **external plugin**: it lives in its own repository, builds to plain
ESM, and is discovered at runtime through `FDPM_PLUGIN_PATH`. Nothing needs to
be added to the FDPM CLI tree.

---

## What it models

Four FRBR layers, with the layer pinned on every resource type so a track
cannot be typed as a work and an ISBN cannot be attached to an expression:

| Layer           | Meaning                     | Types                                                                                                                                                                    |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `work`          | The abstract creation       | `MusicComposition`, `LiteraryWork`, `MovieWork`, `TvSeriesWork`, `PodcastSeriesWork`                                                                                     |
| `expression`    | A realization of it         | `MusicRecording`, `TextExpression`, `AvCut`                                                                                                                              |
| `manifestation` | A published embodiment      | `MusicRelease`, `MusicTrack`, `BookEdition`, `NewsArticle`, `ScholarlyArticle`, `VideoPublication`, `PodcastEpisode`, `SocialPost`, `Comment`, `Review`, `ComponentPart` |
| `asset`         | One retrievable byte stream | `ImageAsset`, `AudioAsset`, `VideoAsset`, `TextAsset`                                                                                                                    |

Plus `Agent`, `Identifier`, `Concept`, `ProviderRecord`, `Collection` and
`Annotation` — 29 primitive types, 23 relation types, 8 shared structs.

**Composition is a foreign key; association is an edge.** A track cannot exist
without its release, so `releaseId` is a field. An adaptation, a citation, a
sample or a reply crosses ownership boundaries and is frequently asserted rather
than known, so each is a relation carrying its own `assertionKind`,
`confidence`, `assertedBy` and `assertedAt`.

### Standards it aligns to

schema.org (exchange classes), W3C Web Annotation (targets, selectors,
motivations), W3C Media Fragments (temporal and spatial addressing), Dublin
Core, ActivityStreams 2.0, IPTC NewsML-G2 and Media Topics, EBUCore,
MusicBrainz, ONIX, PROV-O and CiTO. What the alignment does and does not claim
is in [DISCLAIMER.md](DISCLAIMER.md).

### The identifier invariant

21 external registries — ORCID, ISNI, ISWC, ISRC, MusicBrainz, UPC/EAN, IMDb,
TMDB, EIDR, ISBN-13, ISSN, DOI, PubMed, YouTube, Spotify, AT Protocol,
ActivityPub, Wikidata — each declaring the FRBR layer it addresses and an
anchored syntax pattern. Writing an ISRC against an album is rejected by the
host, not caught in review:

```
media:val:identifier-scheme-and-layer
  field_values.addressesLayer
  ISRC addresses the expression layer, not manifestation
```

## Install and load

```sh
npm install
npm run check          # format, types, tests, build, runtime load
```

`npm run build` produces a self-contained `dist/` — the built ESM plus a copy of
`fdpm-plugin.json`. That directory _is_ the plugin. Point the host at its parent:

```sh
cp -r dist "$HOME/.fdpm/plugins/fdpm-media"
export FDPM_PLUGIN_PATH="$HOME/.fdpm/plugins"
fdpm plugin list
```

### Making the host activate it

Discovery is not activation. `activateAuto()` in the host enables only the
`core` and `verified` trust tiers, and a plugin outside the CLI tree infers as
`community` — it registers, then sits `disabled`. `fdpm plugin enable` does not
persist across processes, so the durable route is the trust tier:

```jsonc
// fdpm-plugin.json
"trust": { "signed_by": "your-key-id" }
```

```sh
export FDPM_TRUSTED_KEYS=your-key-id
```

That check is a plaintext match of `signed_by` against `FDPM_TRUSTED_KEYS`;
there is no signature verification in the host. Treat control of
`FDPM_PLUGIN_PATH` as the actual trust decision. `FDPM_NO_PLUGINS=1` suppresses
all plugin loading, including this one.

## What it contributes

| Capability      | Name                            | What it does                                                               |
| --------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `cap:profile`   | `media`                         | The domain profile                                                         |
| `cap:validator` | `identifier-scheme-and-layer`   | Registry syntax, and the layer it addresses against the record it names    |
| `cap:validator` | `localized-text-primary-locale` | Every localized value resolves its declared primary locale                 |
| `cap:validator` | `assertion-confidence`          | An inference carries confidence, a fact does not, no edge points at itself |
| `cap:validator` | `acyclic-predicate`             | Rejects an edge closing a cycle on a predicate declared acyclic            |
| `cap:exporter`  | `media-jsonld`                  | JSON-LD projection over schema.org, `oa:` and PROV-O; deterministic        |

Six CEL rules cover the cross-field invariants that need no code: ordered time
and page ranges, a rating inside its own scale, `other` requiring a registry
name, an audiobook declaring its duration, a repost carrying no body.

## Repository layout

```
src/annotations.ts       x-* annotations carried inside FieldDef.description
src/vocabulary.ts        closed enums; the identifier registry table
src/fields.ts            typed FieldDef constructors that emit their annotations
src/structs.ts           cross-cutting value types, defined once
src/primitives.ts        the 29 types, laid out on the four layers
src/relations.ts         23 association edges, one per predicate
src/validation-rules.ts  declarative CEL checks
src/validators.ts        checks the meta-model cannot express
src/exporter.ts          JSON-LD projection
src/profile.ts           assembly
src/index.ts             manifest + activate
docs/ARCHITECTURE.md     mapping decisions and rejected alternatives
docs/SCORECARD.md        the schema-design standard's verdict
```

## Verification

138 tests, all passing; 98.54% statements and 91.39% branches on `src/`, against
an 80% floor. The figures come from `npm run coverage`.

The distinctive one is `tests/schema-rules.test.ts`: every checkable rule of the
"Rules for Great Schema Design" standard, expressed as an assertion over the
profile. A numeric field with no unit, a reference with no declared target, a
list with no ordering, a deprecation missing its sunset — each fails the build.
It caught three real defects during development, recorded in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#5-deliberate-deviations-from-the-source).

`npm run check` also runs `scripts/verify-load.mjs`, which copies `dist/` into a
staged plugin-path layout and hands it to a **real `Host`**: discovery from a
`FDPM_PLUGIN_PATH` entry, activation with the host's own `PluginContext`, then
three assertions against the running host — the profile reaches the registry
with the shape the module declares, `media:val:identifier-scheme-and-layer`
rejects an ISRC declared at the manifestation layer, and `runExporter` produces
JSON-LD carrying an `@context`.

The host is there because a mock was not enough. Until v0.1.1 this script
activated against a hand-written context object, and that object was written
from the same reading of the host contract as the plugin: both said `ctx.log`
where the host says `ctx.logger`. The script passed while the host quarantined
the plugin on contact and `profile:media:1.0` never registered. A stand-in
derived from the code under test cannot falsify that code. Each check here has
been confirmed to fail under fault injection.

## Documents

- [CLAUDE.md](CLAUDE.md) — how to build here: process, standards, enforcement
- [DISCLAIMER.md](DISCLAIMER.md) — what is checked mechanically and what is not
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — mapping decisions and their rejected alternatives
- [docs/SCORECARD.md](docs/SCORECARD.md) — the schema-design scorecard, rule by rule
- [CHANGELOG.md](CHANGELOG.md) — versions and compatibility classification

## License

MIT.

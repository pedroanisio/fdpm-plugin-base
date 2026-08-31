# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The profile carries its own semver, declared as `PROFILE_VERSION`; this file
records the plugin's.

## [0.1.0] — 2026-08-31

First release. Profile `profile:media:1.0` at version `0.1.0`.

### Added

- **Profile** with 29 primitive types across the four FRBR layers (work,
  expression, manifestation, asset), 23 relation types (one per predicate),
  8 shared structs and 6 CEL validation rules.
- **Identifier registry** covering 21 external schemes — ORCID, ISNI, Wikidata,
  ISWC, ISRC, MusicBrainz (4), UPC/EAN, IMDb, TMDB, EIDR, ISBN-13, ISSN, DOI,
  PubMed, YouTube (2), Spotify, AT Protocol, ActivityPub — each declaring the
  FRBR layer it addresses and an anchored syntax pattern, plus an `other`
  escape hatch requiring a namespaced registry name.
- **Four code validators** for constraints the meta-model cannot express:
  identifier scheme and layer agreement, localized-text primary locale,
  assertion confidence, and acyclicity on the nine predicates declared acyclic.
- **JSON-LD exporter** (`media-jsonld`) projecting to schema.org classes, W3C
  Web Annotation terms and PROV-O provenance, deterministic under reordering.
- **Executable scorecard** — the schema-design standard's checkable rules as
  test assertions, so the verdict in `docs/SCORECARD.md` is a gate.

### Compatibility

Nothing to be compatible with yet. From 0.2.0 onward, changes are classified by
the matrix in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#evolution-policy):
adding an optional field or a union variant is a minor bump; removing a field,
narrowing an enum, tightening a constraint or renaming anything is major and
requires a deprecation cycle.

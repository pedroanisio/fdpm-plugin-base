# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The profile carries its own semver, declared as `PROFILE_VERSION`; this file
records the plugin's.

## [0.1.1] — 2026-08-31

### Fixed

- **The plugin could not activate.** `activate()` reached the host logger as
  `ctx.log`; the host names that member `ctx.logger` (SPEC-CORE 6.2
  `PluginContext`). Activation threw, the host quarantined the plugin, and
  `profile:media:1.0` never entered the profile registry — so nothing the
  plugin contributes was reachable from any host process.
- **`src/host-contract.ts` declared a member the host does not supply.** The
  interface carried `manifest` on the context; the host supplies no such
  member and the entry module never read it. Removed, so the declared contract
  is a subset of the host's rather than a superset.

### Changed

- **`scripts/verify-load.mjs` activates against a real `Host`.** It previously
  activated against a hand-written context object, which was derived from the
  same assumption as the plugin and therefore agreed with it about `ctx.log`.
  The script reported the packaging correct while the host rejected it on
  contact — a control that could not fail. It now discovers the staged build
  from a `FDPM_PLUGIN_PATH` search path, activates it with the host's own
  context, asserts the profile reaches the registry with the shape the module
  declares, requires `media:val:identifier-scheme-and-layer` to reject an ISRC
  declared at the manifestation layer, and runs the JSON-LD exporter through
  `runExporter`. Each check was confirmed to fail under fault injection.

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

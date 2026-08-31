# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The profile carries its own semver, declared as `PROFILE_VERSION`; this file
records the plugin's.

## [0.2.0] — 2026-08-31

Profile `profile:media:1.0` moves to version `0.2.0`. Additive: no type, field,
enum or rule changed, so a 0.1.x record validates unchanged.

### Added

- **Two `cap:renderer` capabilities, both `text/markdown`.**
  `media:CatalogueRenderer` (`catalogue.md`) renders the FRBR spine — each work
  with the expressions, manifestations and assets it owns, identifiers resolved
  against their registries, credits read off `attributedTo` edges, and a
  contents inventory by layer. `media:AnnotationIndexRenderer`
  (`annotations.md`) groups annotations under the resources they are attached
  to and prints only the anchor the record's `selectorType` discriminates.
  Until now the profile declared no renderer, so `ProfileRegistry.getResolved`
  appended the host's profile-generic `core:WorkbookRenderer` and a media
  workbook rendered as one table per type — every FRBR relationship reduced to
  an opaque id in a cell.
- **`render:server` permission.** `registerRenderer` is permission-gated;
  declaring the capability without the permission throws inside `activate()`
  and quarantines the plugin.
- **`renderers` bindings on the profile.** `PluginRuntime.findRenderer`
  disambiguates a shared target through the profile's own bindings before
  falling back to insertion order, so a media workbook can no longer render
  through another plugin's `text/markdown` renderer because that plugin loaded
  first. `RENDERER_BINDINGS` and the `registerRenderer` calls are both
  generated from one table in `src/renderers/index.ts`, and a test asserts the
  manifest's `cap:renderer` rows match it — the three declaration sites cannot
  drift apart.

### Changed

- **`scripts/verify-load.mjs` exercises both renderers through the real
  `Host`.** It asserts the resolved profile carries this plugin's bindings,
  that a bare `text/markdown` request resolves to `media:CatalogueRenderer`
  rather than to core's generic renderer, and that both documents pass the
  host's SPEC-CORE §6.5 output gate (content type, size cap, UTF-8).
- **`src/host-contract.ts` declares `registerRenderer`** and the renderer
  input, output and finding shapes it needs.

### Design notes

- **A renderer handed another profile's workbook refuses in-band rather than
  raising.** The host quarantines a plugin for any throw that is not its own
  `FDPMException`, and that class is reachable only through a runtime import of
  `@fdpm/cli` — which a deployed plugin directory, copied without
  `node_modules`, cannot resolve. The refusal document plus a finding keeps
  `--strict` honest and the plugin active. `src/exporter.ts` is deliberately
  unchanged: an empty `@graph` would assert that a workbook has no records, so
  refusing by raising is correct there even though the host responds by
  quarantining. See [docs/ARCHITECTURE.md §8](docs/ARCHITECTURE.md#8-rendering).
- **A composition cycle is cut when the workbook is indexed, not guarded
  against during the walk.** Every record in a cycle has a parent, so none is a
  root, so a forest walk would render none of them at all. Cutting the closing
  link and reporting it keeps every record in the document.

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

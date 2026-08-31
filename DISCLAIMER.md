# Disclaimer

No information in this repository should be taken for granted. Any statement or
premise not backed by a verifiable reference or an executed check may be
invalid, erroneous, or a hallucination. Readers are responsible for independent
verification.

## What is checked mechanically

These claims are enforced by the test suite and fail the build when broken:

- The profile parses against the `DomainProfile` schema exported by `@fdpm/cli`
  — the host's own meta-model, not a local copy of it.
- Every rule in the "Rules for Great Schema Design" scorecard that can be
  expressed as a check is one, in `tests/schema-rules.test.ts`. The verdict in
  [docs/SCORECARD.md](docs/SCORECARD.md) is the report; those assertions are the gate.
- Each identifier registry's syntax pattern accepts a known-good value and
  rejects a known-bad one, so no pattern is vacuous.
- The built `dist/` directory loads through a real dynamic import from a staged
  plugin-path layout (`npm run check` runs `scripts/verify-load.mjs`).

## What is not checked

- **Standards conformance is asserted, not certified.** The mapping to
  schema.org, W3C Web Annotation, IPTC, EBUCore, ONIX, MusicBrainz and PROV-O
  follows the published vocabularies as read; no conformance suite from any of
  those bodies has been run against this profile.
- **Identifier patterns check syntax, never registration.** A syntactically
  valid ISBN that no publisher was ever issued passes.
- **Check-digit algorithms are not implemented.** ISBN-13, ISNI and ORCID all
  carry check digits; the patterns here do not compute them.
- **The CEL validation rules are declared, not executed here.** They are
  evaluated by the host's expression runtime, which this repository's tests do
  not stand up. Their syntax follows the form the host's shipped plugins use.
- **Coverage is not correctness.** The figures in the README come from an
  actual run and say which lines executed, not that the model is right.

## Provenance

The profile was authored with Claude Opus 5 (Claude Code) against the media
schema supplied by the operator and the FDPM host source. Design decisions and
their rejected alternatives are recorded in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

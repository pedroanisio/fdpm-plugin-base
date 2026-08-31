import { describe, expect, it } from "vitest";
import {
  ACYCLIC_PREDICATES,
  ASSERTION_KINDS,
  IDENTIFIER_SCHEMES,
  INVERSE_PREDICATES,
  LAYERS,
  PROFILE_ID,
  PROFILE_VERSION,
  RELATION_PREDICATES,
  schemeByName,
} from "../src/vocabulary.js";

describe("vocabulary", () => {
  it("PROFILE_VERSION_is_a_literal_semver_readable_from_the_schema", () => {
    // Rule 19: the version must be determinable by reading the schema, not
    // by resolving a build-time constant.
    expect(PROFILE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PROFILE_ID).toBe("profile:media:1.0");
  });

  it("LAYERS_are_the_four_FRBR_levels_in_containment_order", () => {
    expect(LAYERS).toEqual(["work", "expression", "manifestation", "asset"]);
  });

  it("ASSERTION_KINDS_are_closed_and_distinct", () => {
    expect(new Set(ASSERTION_KINDS).size).toBe(ASSERTION_KINDS.length);
    expect(ASSERTION_KINDS).toContain("inference");
  });

  it("RELATION_PREDICATES_contain_no_duplicates", () => {
    expect(new Set(RELATION_PREDICATES).size).toBe(RELATION_PREDICATES.length);
  });

  it("ACYCLIC_PREDICATES_is_a_subset_of_RELATION_PREDICATES", () => {
    for (const p of ACYCLIC_PREDICATES) {
      expect(RELATION_PREDICATES, `${p} is not a declared predicate`).toContain(p);
    }
  });

  // The inverse is a name for the implied direction, never a second stored
  // edge: persisting both `cites` and `isCitedBy` creates two records of one
  // fact that can disagree. So the forward predicate must be storable and the
  // inverse must not be.
  it("INVERSE_PREDICATES_map_a_storable_predicate_to_a_non_storable_inverse", () => {
    const entries = Object.entries(INVERSE_PREDICATES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [forward, inverse] of entries) {
      expect(RELATION_PREDICATES, `${forward} is not storable`).toContain(forward);
      expect(RELATION_PREDICATES, `${inverse} is storable as well as implied`).not.toContain(
        inverse,
      );
      expect(forward).not.toBe(inverse);
    }
  });

  it("IDENTIFIER_SCHEMES_have_unique_names", () => {
    const names = IDENTIFIER_SCHEMES.map((s) => s.scheme);
    expect(new Set(names).size).toBe(names.length);
  });

  it("IDENTIFIER_SCHEMES_declare_a_layer_each", () => {
    for (const s of IDENTIFIER_SCHEMES) {
      expect(
        ["agent", ...LAYERS, "unspecified"],
        `${s.scheme} declares layer ${s.layer}`,
      ).toContain(s.layer);
    }
  });

  // The point of a per-scheme pattern is that it rejects the wrong thing.
  // A pattern that accepts everything would pass a syntax check and catch
  // nothing, so each scheme ships a known-good and a known-bad sample.
  it("IDENTIFIER_SCHEMES_patterns_accept_valid_and_reject_invalid_samples", () => {
    for (const s of IDENTIFIER_SCHEMES) {
      expect(s.pattern.test(s.validSample), `${s.scheme} rejects its own valid sample`).toBe(true);
      expect(s.pattern.test(s.invalidSample), `${s.scheme} accepts an invalid sample`).toBe(false);
    }
  });

  it("IDENTIFIER_SCHEMES_patterns_are_anchored_at_both_ends", () => {
    for (const s of IDENTIFIER_SCHEMES) {
      expect(s.pattern.source.startsWith("^"), `${s.scheme} is unanchored at the start`).toBe(true);
      expect(s.pattern.source.endsWith("$"), `${s.scheme} is unanchored at the end`).toBe(true);
    }
  });

  it("IDENTIFIER_SCHEMES_patterns_carry_no_global_flag", () => {
    // A /g regex keeps lastIndex between calls, so the same input tests
    // true then false. A validator built on one is silently order-dependent.
    for (const s of IDENTIFIER_SCHEMES) {
      expect(s.pattern.global, `${s.scheme} pattern is global`).toBe(false);
    }
  });

  it("schemeByName_known_scheme_returns_the_descriptor", () => {
    expect(schemeByName("isbn13")?.layer).toBe("manifestation");
  });

  it("schemeByName_unknown_scheme_returns_undefined", () => {
    expect(schemeByName("not-a-scheme")).toBeUndefined();
  });
});

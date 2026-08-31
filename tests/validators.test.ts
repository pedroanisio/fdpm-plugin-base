import { describe, expect, it } from "vitest";
import type { PrimitiveInstance, RelationInstance } from "@fdpm/cli";
import {
  RULE_ACYCLIC,
  buildValidators,
  RULE_ASSERTION,
  RULE_IDENTIFIER,
  RULE_LOCALIZED,
  findCycle,
  validateAcyclic,
  validateAssertion,
  validateIdentifier,
  validateLocalizedText,
} from "../src/validators.js";
import type { ValidatorContext } from "../src/host-contract.js";

const UID = "01J0000000000000000000000A";

function primitive(
  type_id: string,
  id: string,
  field_values: Record<string, unknown>,
): PrimitiveInstance {
  return { id, uid: UID, type_id, field_values, revision: 0 };
}

function relation(
  type_id: string,
  id: string,
  source_id: string,
  target_id: string,
  field_values: Record<string, unknown> = {},
): RelationInstance {
  return { id, uid: UID, type_id, source_id, target_id, field_values, revision: 0 };
}

function ctx(
  primitives: PrimitiveInstance[],
  relations: RelationInstance[] = [],
): ValidatorContext {
  return {
    relations,
    workbook: {
      primitives: Object.fromEntries(primitives.map((p) => [p.id, p])),
      relations: Object.fromEntries(relations.map((r) => [r.id, r])),
    },
  };
}

const release = primitive("media:MusicRelease", "manifestation:folklore", {
  layer: "manifestation",
});
const recording = primitive("media:MusicRecording", "expression:cardigan", {
  layer: "expression",
});

// -- identifier: scheme syntax and FRBR layer agreement ---------------------

describe("validateIdentifier", () => {
  it("validateIdentifier_isbn_on_a_manifestation_accepts", () => {
    const id = primitive("media:Identifier", "identifier:isbn-folklore", {
      scheme: "isbn13",
      value: "9780306406157",
      addressesLayer: "manifestation",
      identifiesId: release.id,
    });
    expect(validateIdentifier(id, ctx([release, id]))).toEqual([]);
  });

  it("validateIdentifier_unknown_scheme_rejects", () => {
    const id = primitive("media:Identifier", "identifier:bogus", {
      scheme: "not-a-registry",
      value: "x",
      addressesLayer: "manifestation",
      identifiesId: release.id,
    });
    const findings = validateIdentifier(id, ctx([release, id]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule_id).toBe(RULE_IDENTIFIER);
    expect(findings[0]?.field_path).toBe("field_values.scheme");
  });

  it("validateIdentifier_value_failing_scheme_syntax_rejects", () => {
    const id = primitive("media:Identifier", "identifier:isbn-short", {
      scheme: "isbn13",
      value: "12345",
      addressesLayer: "manifestation",
      identifiesId: release.id,
    });
    const findings = validateIdentifier(id, ctx([release, id]));
    expect(findings.map((f) => f.field_path)).toContain("field_values.value");
  });

  // The headline invariant of the source model: an ISRC names a recording,
  // so declaring it at the manifestation layer is unrepresentable rather
  // than merely discouraged.
  it("validateIdentifier_declared_layer_contradicting_scheme_rejects", () => {
    const id = primitive("media:Identifier", "identifier:isrc-mislayered", {
      scheme: "isrc",
      value: "USRC17607839",
      addressesLayer: "manifestation",
      identifiesId: release.id,
    });
    const findings = validateIdentifier(id, ctx([release, id]));
    expect(findings.map((f) => f.field_path)).toContain("field_values.addressesLayer");
  });

  it("validateIdentifier_referent_at_a_different_layer_rejects", () => {
    const id = primitive("media:Identifier", "identifier:isrc-on-release", {
      scheme: "isrc",
      value: "USRC17607839",
      addressesLayer: "expression",
      identifiesId: release.id,
    });
    const findings = validateIdentifier(id, ctx([release, id]));
    expect(findings.map((f) => f.field_path)).toContain("field_values.identifiesId");
  });

  it("validateIdentifier_referent_at_the_matching_layer_accepts", () => {
    const id = primitive("media:Identifier", "identifier:isrc-cardigan", {
      scheme: "isrc",
      value: "USRC17607839",
      addressesLayer: "expression",
      identifiesId: recording.id,
    });
    expect(validateIdentifier(id, ctx([recording, id]))).toEqual([]);
  });

  it("validateIdentifier_unresolvable_referent_rejects", () => {
    const id = primitive("media:Identifier", "identifier:dangling", {
      scheme: "isbn13",
      value: "9780306406157",
      addressesLayer: "manifestation",
      identifiesId: "manifestation:absent",
    });
    const findings = validateIdentifier(id, ctx([id]));
    expect(findings.map((f) => f.field_path)).toContain("field_values.identifiesId");
  });

  // A validator that needs the workbook and does not get it must fail
  // explicitly. Skipping the check would report a clean write for an
  // unverified one.
  it("validateIdentifier_absent_context_rejects_rather_than_skipping", () => {
    const id = primitive("media:Identifier", "identifier:no-context", {
      scheme: "isbn13",
      value: "9780306406157",
      addressesLayer: "manifestation",
      identifiesId: release.id,
    });
    const findings = validateIdentifier(id);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/workbook/i);
  });

  it("validateIdentifier_unspecified_layer_scheme_accepts_any_declared_layer", () => {
    // A DOI does not declare its layer; the registrant chooses. Consumers
    // must not assume, so the check stands down rather than guessing.
    const id = primitive("media:Identifier", "identifier:doi-work", {
      scheme: "doi",
      value: "10.1000/182",
      addressesLayer: "work",
      identifiesId: "work:evermore",
    });
    const work = primitive("media:MusicComposition", "work:evermore", { layer: "work" });
    expect(validateIdentifier(id, ctx([work, id]))).toEqual([]);
  });

  it("validateIdentifier_missing_required_field_rejects", () => {
    const id = primitive("media:Identifier", "identifier:empty", {});
    expect(validateIdentifier(id, ctx([id])).length).toBeGreaterThan(0);
  });

  it("validateIdentifier_non_string_scheme_rejects", () => {
    const id = primitive("media:Identifier", "identifier:typed-wrong", {
      scheme: 42,
      value: "9780306406157",
      addressesLayer: "manifestation",
      identifiesId: release.id,
    });
    expect(validateIdentifier(id, ctx([release, id])).length).toBeGreaterThan(0);
  });
});

// -- assertion: epistemic status and confidence --------------------------

describe("validateAssertion", () => {
  it("validateAssertion_inference_with_confidence_accepts", () => {
    const edge = relation("media:Samples", "rel:1", "a", "b", {
      assertionKind: "inference",
      confidence: 0.82,
      assertedBy: "acoustid",
      assertedAt: "2026-08-31T00:00:00Z",
    });
    expect(validateAssertion(edge)).toEqual([]);
  });

  it("validateAssertion_inference_without_confidence_rejects", () => {
    const edge = relation("media:Samples", "rel:2", "a", "b", {
      assertionKind: "inference",
      assertedBy: "acoustid",
      assertedAt: "2026-08-31T00:00:00Z",
    });
    const findings = validateAssertion(edge);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule_id).toBe(RULE_ASSERTION);
  });

  it("validateAssertion_fact_carrying_confidence_rejects", () => {
    const edge = relation("media:Samples", "rel:3", "a", "b", {
      assertionKind: "fact",
      confidence: 1,
      assertedBy: "editor",
      assertedAt: "2026-08-31T00:00:00Z",
    });
    expect(validateAssertion(edge)).toHaveLength(1);
  });

  it("validateAssertion_confidence_outside_unit_interval_rejects", () => {
    const edge = relation("media:Samples", "rel:4", "a", "b", {
      assertionKind: "inference",
      confidence: 1.5,
      assertedBy: "acoustid",
      assertedAt: "2026-08-31T00:00:00Z",
    });
    expect(validateAssertion(edge)).toHaveLength(1);
  });

  it("validateAssertion_unknown_assertion_kind_rejects", () => {
    const edge = relation("media:Samples", "rel:5", "a", "b", {
      assertionKind: "vibes",
      assertedBy: "editor",
      assertedAt: "2026-08-31T00:00:00Z",
    });
    expect(validateAssertion(edge)).toHaveLength(1);
  });

  it("validateAssertion_self_referential_edge_rejects", () => {
    const edge = relation("media:Samples", "rel:6", "same", "same", {
      assertionKind: "claim",
      assertedBy: "editor",
      assertedAt: "2026-08-31T00:00:00Z",
    });
    expect(validateAssertion(edge).length).toBeGreaterThan(0);
  });
});

// -- localization ---------------------------------------------------------

describe("validateLocalizedText", () => {
  it("validateLocalizedText_primary_locale_present_accepts", () => {
    const p = primitive("media:MusicRelease", "manifestation:x", {
      layer: "manifestation",
      title: {
        primaryLocale: "en-US",
        values: [{ locale: "en-US", text: "folklore" }],
        translatedLocales: [],
      },
    });
    expect(validateLocalizedText(p)).toEqual([]);
  });

  it("validateLocalizedText_primary_locale_absent_from_values_rejects", () => {
    const p = primitive("media:MusicRelease", "manifestation:y", {
      layer: "manifestation",
      title: {
        primaryLocale: "pt-BR",
        values: [{ locale: "en-US", text: "folklore" }],
        translatedLocales: [],
      },
    });
    const findings = validateLocalizedText(p);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule_id).toBe(RULE_LOCALIZED);
  });

  it("validateLocalizedText_empty_values_map_rejects", () => {
    const p = primitive("media:MusicRelease", "manifestation:z", {
      layer: "manifestation",
      title: { primaryLocale: "en-US", values: [], translatedLocales: [] },
    });
    expect(validateLocalizedText(p)).toHaveLength(1);
  });

  it("validateLocalizedText_malformed_locale_tag_rejects", () => {
    const p = primitive("media:MusicRelease", "manifestation:w", {
      layer: "manifestation",
      title: {
        primaryLocale: "english",
        values: [{ locale: "english", text: "folklore" }],
        translatedLocales: [],
      },
    });
    expect(validateLocalizedText(p)).toHaveLength(1);
  });

  it("validateLocalizedText_field_absent_accepts", () => {
    const p = primitive("media:MusicRelease", "manifestation:v", { layer: "manifestation" });
    expect(validateLocalizedText(p)).toEqual([]);
  });
});

// -- graph topology -------------------------------------------------------

describe("findCycle", () => {
  it("findCycle_acyclic_chain_returns_null", () => {
    expect(
      findCycle([
        ["a", "b"],
        ["b", "c"],
      ]),
    ).toBeNull();
  });

  it("findCycle_direct_cycle_returns_the_participants", () => {
    const cycle = findCycle([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("a");
  });

  it("findCycle_self_loop_returns_the_node", () => {
    expect(findCycle([["a", "a"]])).toEqual(["a", "a"]);
  });

  it("findCycle_disjoint_components_finds_the_cyclic_one", () => {
    const cycle = findCycle([
      ["a", "b"],
      ["c", "d"],
      ["d", "c"],
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("c");
  });

  it("findCycle_empty_edge_set_returns_null", () => {
    expect(findCycle([])).toBeNull();
  });
});

describe("validateAcyclic", () => {
  it("validateAcyclic_edge_closing_a_cycle_on_a_dag_predicate_rejects", () => {
    const existing = relation("media:PartOf", "rel:a", "x", "y");
    const closing = relation("media:PartOf", "rel:b", "y", "x");
    const findings = validateAcyclic(closing, ctx([], [existing, closing]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule_id).toBe(RULE_ACYCLIC);
  });

  it("validateAcyclic_edge_leaving_the_graph_acyclic_accepts", () => {
    const existing = relation("media:PartOf", "rel:a", "x", "y");
    const added = relation("media:PartOf", "rel:b", "y", "z");
    expect(validateAcyclic(added, ctx([], [existing, added]))).toEqual([]);
  });

  it("validateAcyclic_cycle_on_a_cycle_tolerant_predicate_accepts", () => {
    const a = relation("media:Mentions", "rel:a", "x", "y");
    const b = relation("media:Mentions", "rel:b", "y", "x");
    expect(validateAcyclic(b, ctx([], [a, b]))).toEqual([]);
  });

  it("validateAcyclic_absent_context_rejects_rather_than_skipping", () => {
    const edge = relation("media:PartOf", "rel:a", "x", "y");
    expect(validateAcyclic(edge).length).toBeGreaterThan(0);
  });
});

// -- registration adapters -------------------------------------------------

// The host calls a validator as (instance, type, profile, context). A check
// written as (instance, context) receives the resolved type definition in
// place of the workbook and reports "not supplied" on every write, so the
// adapter's argument positions are themselves part of the contract.
describe("buildValidators", () => {
  it("buildValidators_registered_validator_receives_the_context_in_host_position", () => {
    const registered = buildValidators([], ["media:PartOf"]).find(
      (v) => v.rule_id === RULE_ACYCLIC,
    );
    expect(registered).toBeDefined();
    const existing = relation("media:PartOf", "rel:a", "x", "y");
    const closing = relation("media:PartOf", "rel:b", "y", "x");
    const findings = registered!.fn(
      closing,
      { id: "media:PartOf" },
      {},
      ctx([], [existing, closing]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule_id).toBe(RULE_ACYCLIC);
  });

  it("buildValidators_registers_the_identifier_rule_once", () => {
    const built = buildValidators(["media:MusicRelease"], ["media:PartOf"]);
    expect(built.filter((v) => v.rule_id === RULE_IDENTIFIER)).toHaveLength(1);
  });

  it("buildValidators_registers_localization_for_every_resource_type", () => {
    const built = buildValidators(["media:MusicRelease", "media:BookEdition"], []);
    expect(built.filter((v) => v.rule_id === RULE_LOCALIZED).map((v) => v.type_id)).toEqual([
      "media:MusicRelease",
      "media:BookEdition",
    ]);
  });

  it("buildValidators_standalone_validator_ignores_the_host_type_argument", () => {
    const registered = buildValidators([], ["media:Samples"]).find(
      (v) => v.rule_id === RULE_ASSERTION,
    );
    const edge = relation("media:Samples", "rel:1", "a", "b", {
      assertionKind: "inference",
      assertedBy: "acoustid",
      assertedAt: "2026-08-31T00:00:00Z",
    });
    expect(registered!.fn(edge, { id: "media:Samples" }, {}, ctx([], [edge]))).toHaveLength(1);
  });
});

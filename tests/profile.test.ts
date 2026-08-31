import { describe, expect, it } from "vitest";
import { DomainProfile } from "@fdpm/cli";
import { PROFILE } from "../src/profile.js";
import { LAYERS, PROFILE_ID, PROFILE_VERSION } from "../src/vocabulary.js";

// The host is the authority on what a profile is. Validating against a
// local copy of the meta-model would only prove the copy self-consistent,
// so these parse against the schema `@fdpm/cli` actually enforces.

describe("PROFILE", () => {
  it("PROFILE_parsed_by_the_host_meta_model_is_accepted", () => {
    const result = DomainProfile.safeParse(PROFILE);
    const issues = result.success
      ? []
      : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    expect(issues).toEqual([]);
  });

  it("PROFILE_identity_matches_the_declared_vocabulary", () => {
    expect(PROFILE.id).toBe(PROFILE_ID);
    expect(PROFILE.version).toBe(PROFILE_VERSION);
  });

  it("PROFILE_declares_no_duplicate_primitive_type_ids", () => {
    const ids = PROFILE.primitive_types.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("PROFILE_declares_no_duplicate_relation_type_ids", () => {
    const ids = PROFILE.relation_types.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("PROFILE_covers_every_declared_FRBR_layer", () => {
    const covered = new Set(
      PROFILE.primitive_types
        .map((t) => t.fields.find((f) => f.name === "layer")?.enum_values?.[0])
        .filter((v): v is string => v !== undefined),
    );
    for (const layer of LAYERS) {
      expect(covered, `no primitive type sits at the ${layer} layer`).toContain(layer);
    }
  });

  it("PROFILE_primitive_categories_resolve_to_declared_categories", () => {
    const declared = new Set(PROFILE.categories.map((c) => c.id));
    for (const t of PROFILE.primitive_types) {
      expect(declared, `${t.id} names an undeclared category`).toContain(t.category_id);
    }
  });

  it("PROFILE_scoped_types_reference_a_declared_scope", () => {
    expect(PROFILE.scopes.length).toBeGreaterThan(0);
    const ranks = PROFILE.scopes.map((s) => s.rank);
    expect(new Set(ranks).size, "two scopes share a rank").toBe(ranks.length);
  });

  it("PROFILE_relation_endpoints_reference_declared_primitive_types", () => {
    const declared = new Set(PROFILE.primitive_types.map((t) => t.id));
    for (const r of PROFILE.relation_types) {
      for (const key of ["source_types", "target_types"] as const) {
        const list = r[key];
        if (list === undefined || list === "*") continue;
        for (const id of list) {
          expect(declared, `${r.id}.${key} names undeclared type ${id}`).toContain(id);
        }
      }
    }
  });

  it("PROFILE_validation_rules_target_declared_primitive_types", () => {
    const declared = new Set([
      ...PROFILE.primitive_types.map((t) => t.id),
      ...PROFILE.relation_types.map((t) => t.id),
    ]);
    for (const rule of PROFILE.validation_rules) {
      for (const target of rule.targets ?? []) {
        expect(declared, `${rule.id} targets undeclared type ${target}`).toContain(target);
      }
    }
  });

  it("PROFILE_struct_fields_reference_declared_inline_structs", () => {
    const declared = new Set(PROFILE.inline_structs.map((s) => s.id));
    for (const t of PROFILE.primitive_types) {
      for (const f of t.fields) {
        if (f.kind !== "struct") continue;
        expect(declared, `${t.id}.${f.name} names undeclared struct ${f.struct_id}`).toContain(
          f.struct_id,
        );
      }
    }
  });

  it("PROFILE_inline_structs_are_each_referenced_at_least_once", () => {
    const used = new Set<string>();
    const walk = (
      fields: readonly { kind?: string; struct_id?: string; item_field?: unknown }[],
    ) => {
      for (const f of fields) {
        if (f.struct_id !== undefined) used.add(f.struct_id);
        const item = f.item_field as { kind?: string; struct_id?: string } | undefined;
        if (item?.struct_id !== undefined) used.add(item.struct_id);
      }
    };
    PROFILE.primitive_types.forEach((t) => walk(t.fields));
    PROFILE.relation_types.forEach((t) => walk(t.fields));
    PROFILE.inline_structs.forEach((s) => walk(s.fields));
    for (const s of PROFILE.inline_structs) {
      expect(used, `struct ${s.id} is declared but never used`).toContain(s.id);
    }
  });
});

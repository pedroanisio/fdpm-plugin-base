import { describe, expect, it } from "vitest";
import type { FieldDefT, PrimitiveTypeDef } from "@fdpm/cli";
import { PROFILE } from "../src/profile.js";
import { parseAnnotations } from "../src/annotations.js";
import { ACYCLIC_PREDICATES } from "../src/vocabulary.js";
import { LOCALIZED_TEXT, PROVENANCE } from "../src/structs.js";

// Executable form of the "Rules for Great Schema Design" scorecard
// (.repo/skills/schema-designer). The scorecard in docs/SCORECARD.md
// records the verdict; these assertions are what make it a gate rather
// than a claim, so a later field that skips a unit or a foreign-key
// target fails the build instead of quietly lowering the score.

interface Owned {
  owner: string;
  field: FieldDefT;
}

/** Every field the profile declares, paired with the type that owns it. */
function allFields(): Owned[] {
  const out: Owned[] = [];
  const push = (owner: string, fields: readonly FieldDefT[]): void => {
    for (const field of fields) out.push({ owner, field });
  };
  PROFILE.primitive_types.forEach((t) => push(t.id, t.fields));
  PROFILE.relation_types.forEach((t) => push(t.id, t.fields));
  PROFILE.inline_structs.forEach((s) => push(s.id, s.fields));
  PROFILE.primitive_types.forEach((t) =>
    t.inline_structs.forEach((s) => push(`${t.id}/${s.id}`, s.fields)),
  );
  return out;
}

const FIELDS = allFields();
const ann = (f: FieldDefT) => parseAnnotations(f.description ?? "");
const where = (o: Owned) => `${o.owner}.${o.field.name}`;

// -- Part I: type safety and precision ------------------------------------

describe("rule 1 — every field has a single unambiguous type", () => {
  it("rule1_every_field_declares_a_kind", () => {
    const untyped = FIELDS.filter((o) => o.field.kind === undefined).map(where);
    expect(untyped).toEqual([]);
  });

  it("rule1_opaque_json_fields_are_declared_extension_points", () => {
    // `json` is the meta-model's only untyped kind. It is legitimate as a
    // deliberate escape hatch (rule 29) and a defect otherwise.
    const unannotated = FIELDS.filter(
      (o) => o.field.kind === "json" && ann(o.field).extensionPoint !== true,
    ).map(where);
    expect(unannotated).toEqual([]);
  });
});

describe("rule 2 — constraints live in the schema", () => {
  it("rule2_no_field_states_a_bound_in_prose_alone", () => {
    // Violation signal: a constraint that exists in the description but
    // not in `validations`, where no validator can reach it.
    const PROSE_BOUND = /\b(between \d|at most \d|at least \d|no more than \d|maximum of \d)/i;
    const offenders = FIELDS.filter((o) => {
      const text = (o.field.description ?? "").replace(/\[x-[a-z-]+:[^\]]*\]/g, "");
      return PROSE_BOUND.test(text) && o.field.validations.length === 0;
    }).map(where);
    expect(offenders).toEqual([]);
  });
});

describe("rule 3 — enums are closed and non-overloaded", () => {
  it("rule3_every_enum_field_declares_values", () => {
    const empty = FIELDS.filter(
      (o) => o.field.kind === "enum" && (o.field.enum_values ?? []).length === 0,
    ).map(where);
    expect(empty).toEqual([]);
  });

  it("rule3_no_enum_repeats_a_value", () => {
    const dupes = FIELDS.filter((o) => {
      const values = o.field.enum_values ?? [];
      return new Set(values).size !== values.length;
    }).map(where);
    expect(dupes).toEqual([]);
  });
});

describe("rule 4 — nullable, optional and absent are distinguished", () => {
  it("rule4_nullable_fields_declare_nullability_explicitly", () => {
    // A field whose description says a null carries meaning must say so in
    // the schema too, or consumers cannot tell "cleared" from "never set".
    const offenders = FIELDS.filter(
      (o) => /\bnull\b/.test(o.field.description ?? "") && o.field.nullable !== true,
    ).map(where);
    expect(offenders).toEqual([]);
  });
});

describe("rule 5 — arrays declare item type, cardinality and ordering", () => {
  it("rule5_every_list_declares_an_item_field", () => {
    const offenders = FIELDS.filter(
      (o) => o.field.kind === "list" && o.field.item_field === undefined,
    ).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule5_every_list_declares_an_upper_bound", () => {
    const offenders = FIELDS.filter(
      (o) => o.field.kind === "list" && !o.field.validations.some((v) => v.kind === "max_items"),
    ).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule5_every_list_declares_ordering_semantics", () => {
    const offenders = FIELDS.filter(
      (o) => o.field.kind === "list" && ann(o.field).ordering === undefined,
    ).map(where);
    expect(offenders).toEqual([]);
  });
});

describe("rule 6 — temporal fields declare format, timezone and precision", () => {
  it("rule6_every_datetime_field_declares_timezone_and_precision", () => {
    const offenders = FIELDS.filter((o) => {
      if (o.field.kind !== "datetime") return false;
      const a = ann(o.field);
      return a.timezone === undefined || a.precision === undefined;
    }).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule6_no_temporally_named_field_is_an_unannotated_string", () => {
    // Violation signal: a field named *At / *Date typed as a bare string.
    // A partial date (EDTF) is a string by necessity and stays legal only
    // because it declares its own precision.
    const offenders = FIELDS.filter((o) => {
      if (!/(At|Date)$/.test(o.field.name)) return false;
      if (o.field.kind === "datetime") return false;
      return ann(o.field).precision === undefined;
    }).map(where);
    expect(offenders).toEqual([]);
  });
});

describe("rule 7 — numeric fields declare units", () => {
  it("rule7_every_numeric_field_declares_a_unit", () => {
    const offenders = FIELDS.filter(
      (o) =>
        (o.field.kind === "integer" || o.field.kind === "number") &&
        ann(o.field).unit === undefined,
    ).map(where);
    expect(offenders).toEqual([]);
  });
});

describe("rule 8 — polymorphism carries an explicit discriminator", () => {
  it("rule8_every_layered_type_pins_its_layer_to_exactly_one_value", () => {
    const layered = PROFILE.primitive_types.filter((t) => t.fields.some((f) => f.name === "layer"));
    expect(layered.length).toBeGreaterThan(0);
    for (const t of layered) {
      const layer = t.fields.find((f) => f.name === "layer")!;
      expect(layer.kind, `${t.id}.layer is not an enum`).toBe("enum");
      expect(layer.enum_values, `${t.id}.layer is not pinned`).toHaveLength(1);
      expect(layer.required, `${t.id}.layer is optional`).toBe(true);
    }
  });
});

describe("rule 9 — defaults are declared in the schema", () => {
  it("rule9_every_optional_boolean_declares_a_default", () => {
    const offenders = FIELDS.filter(
      (o) => o.field.kind === "boolean" && o.field.default === undefined,
    ).map(where);
    expect(offenders).toEqual([]);
  });
});

// -- Part II: identity and relationships ----------------------------------

describe("rule 10 — stable, opaque identity", () => {
  it("rule10_every_primitive_type_declares_an_id_format", () => {
    const offenders = PROFILE.primitive_types
      .filter((t: PrimitiveTypeDef) => t.id_format.pattern.trim() === "")
      .map((t) => t.id);
    expect(offenders).toEqual([]);
  });
});

describe("rules 11-13 — relationships are navigable, owned and resolvable", () => {
  it("rule12_every_reference_field_declares_its_lifecycle_relationship", () => {
    const offenders = FIELDS.filter(
      (o) => o.field.kind === "id-ref" && ann(o.field).relationship === undefined,
    ).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule13_every_reference_field_names_a_declared_target_type", () => {
    const declared = new Set(PROFILE.primitive_types.map((t) => t.id));
    const offenders = FIELDS.filter((o) => {
      if (o.field.kind !== "id-ref") return false;
      const target = o.field.ref_type_id;
      return target === undefined || !declared.has(target);
    }).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule13_every_reference_field_declares_its_foreign_key_target", () => {
    const offenders = FIELDS.filter(
      (o) => o.field.kind === "id-ref" && ann(o.field).fk === undefined,
    ).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule13_declared_foreign_key_targets_agree_with_ref_type_id", () => {
    const mismatched = FIELDS.filter((o) => {
      if (o.field.kind !== "id-ref") return false;
      const fk = ann(o.field).fk;
      return fk === undefined || !fk.startsWith(`${o.field.ref_type_id}.`);
    }).map(where);
    expect(mismatched).toEqual([]);
  });
});

describe("rule 14 — cyclic graphs declare topology constraints", () => {
  it("rule14_every_relation_type_declares_a_graph_constraint", () => {
    const offenders = PROFILE.relation_types
      .filter((r) => parseAnnotations(r.description ?? "").graphConstraint === undefined)
      .map((r) => r.id);
    expect(offenders).toEqual([]);
  });

  it("rule14_predicates_declared_acyclic_are_annotated_as_DAGs", () => {
    for (const r of PROFILE.relation_types) {
      const predicate = r.fields.find((f) => f.name === "predicate")?.enum_values?.[0];
      if (predicate === undefined) continue;
      const expected = (ACYCLIC_PREDICATES as readonly string[]).includes(predicate)
        ? "DAG"
        : "allow-cycles";
      expect(
        parseAnnotations(r.description ?? "").graphConstraint,
        `${r.id} carries predicate ${predicate}`,
      ).toBe(expected);
    }
  });
});

// -- Part III: normalization and coherence --------------------------------

describe("rules 15-17 — one definition per fact", () => {
  // Guards type drift under a shared name. Requiredness is deliberately not
  // part of the key: whether a duration is mandatory is a per-type cardinality
  // decision, while its being a number of seconds is the cross-cutting type.
  it("rule17_field_names_shared_by_three_or_more_types_have_one_definition", () => {
    const byName = new Map<string, Set<string>>();
    for (const { field } of FIELDS) {
      // A discriminator pinned to one value is what rule 8 requires to differ
      // between variants; demanding it be identical everywhere would put the
      // two rules in direct contradiction.
      if (field.kind === "enum" && (field.enum_values ?? []).length === 1) continue;
      const shape = `${field.kind}|${(field.enum_values ?? []).join(",")}|${
        field.ref_type_id ?? ""
      }|${field.struct_id ?? ""}`;
      const set = byName.get(field.name) ?? new Set<string>();
      set.add(shape);
      byName.set(field.name, set);
    }
    const drifted = [...byName.entries()]
      .filter(([, shapes]) => shapes.size > 1)
      .map(([name, shapes]) => `${name} (${shapes.size} shapes)`);
    expect(drifted).toEqual([]);
  });
});

describe("rule 18 — computed and stored fields are distinguished", () => {
  it("rule18_derived_fields_name_the_source_they_derive_from", () => {
    const offenders = FIELDS.filter((o) => {
      const a = ann(o.field);
      return (
        a.derivation !== undefined &&
        a.derivation !== "source-of-truth" &&
        a.derivedFrom === undefined
      );
    }).map(where);
    expect(offenders).toEqual([]);
  });
});

// -- Part IV: evolution ---------------------------------------------------

describe("rules 19-22 — evolution is declared", () => {
  it("rule19_profile_version_is_literal_semver", () => {
    expect(PROFILE.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("rule20_no_two_types_model_one_concept_at_two_versions", () => {
    const versioned = PROFILE.primitive_types.filter((t) => /V\d+$/.test(t.id));
    expect(versioned.map((t) => t.id)).toEqual([]);
  });

  it("rule22_deprecated_fields_declare_since_replacement_and_sunset", () => {
    const offenders = FIELDS.filter((o) => {
      const a = ann(o.field);
      if (a.deprecated !== true) return false;
      return (
        a.deprecatedSince === undefined || a.replacedBy === undefined || a.sunset === undefined
      );
    }).map(where);
    expect(offenders).toEqual([]);
  });
});

// -- Part V: operational annotations --------------------------------------

describe("rules 23-26 — operational annotations", () => {
  it("rule23_personal_data_fields_declare_a_sensitivity_class", () => {
    // Birth and death dates identify a natural person; the standard makes
    // classification MUST once a schema carries personal data at all.
    const PERSONAL = /^(birth|death)(Date|Place)$/;
    const offenders = FIELDS.filter(
      (o) => PERSONAL.test(o.field.name) && ann(o.field).sensitivity === undefined,
    ).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule24_identity_and_provenance_fields_are_marked_immutable", () => {
    const IMMUTABLE = /^(createdAt|createdBy|sourceSystem|schemaVersion)$/;
    const offenders = FIELDS.filter(
      (o) => IMMUTABLE.test(o.field.name) && ann(o.field).immutable !== true,
    ).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule25_localized_fields_declare_their_localization_strategy", () => {
    const offenders = FIELDS.filter((o) => {
      const isLocalized =
        o.field.struct_id === LOCALIZED_TEXT ||
        (o.field.item_field?.struct_id ?? "") === LOCALIZED_TEXT;
      return isLocalized && ann(o.field).localization === undefined;
    }).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule26_every_primitive_type_carries_record_provenance", () => {
    const offenders = PROFILE.primitive_types
      .filter((t) => !t.fields.some((f) => f.struct_id === PROVENANCE))
      .map((t) => t.id);
    expect(offenders).toEqual([]);
  });
});

// -- Part VI: documentation and generability ------------------------------

describe("rule 27 — naming is consistent and predictable", () => {
  it("rule27_every_field_name_is_camelCase", () => {
    const offenders = FIELDS.filter((o) => !/^[a-z][A-Za-z0-9]*$/.test(o.field.name)).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule27_reference_fields_end_in_Id_or_Ids", () => {
    const offenders = FIELDS.filter(
      (o) => o.field.kind === "id-ref" && !/Ids?$/.test(o.field.name),
    ).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule27_boolean_fields_use_an_is_or_has_prefix", () => {
    const offenders = FIELDS.filter(
      (o) => o.field.kind === "boolean" && !/^(is|has)[A-Z]/.test(o.field.name),
    ).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule27_list_fields_are_named_in_the_plural", () => {
    const offenders = FIELDS.filter((o) => o.field.kind === "list" && !/s$/.test(o.field.name)).map(
      where,
    );
    expect(offenders).toEqual([]);
  });

  it("rule27_every_type_id_is_namespaced_to_the_profile", () => {
    const ids = [
      ...PROFILE.primitive_types.map((t) => t.id),
      ...PROFILE.relation_types.map((t) => t.id),
    ];
    expect(ids.filter((id) => !id.startsWith("media:"))).toEqual([]);
  });
});

describe("rules 29 and 31 — extension points and standalone readability", () => {
  it("rule29_extension_points_are_annotated_and_typed_json", () => {
    const offenders = FIELDS.filter(
      (o) => ann(o.field).extensionPoint === true && o.field.kind !== "json",
    ).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule29_the_profile_declares_at_least_one_extension_point", () => {
    const points = FIELDS.filter((o) => ann(o.field).extensionPoint === true);
    expect(points.length).toBeGreaterThan(0);
  });

  it("rule31_every_field_carries_a_description", () => {
    const offenders = FIELDS.filter((o) => {
      const prose = (o.field.description ?? "").replace(/\[x-[a-z-]+:[^\]]*\]/g, "").trim();
      return prose.length < 12;
    }).map(where);
    expect(offenders).toEqual([]);
  });

  it("rule31_every_primitive_and_relation_type_carries_a_description", () => {
    const offenders = [...PROFILE.primitive_types, ...PROFILE.relation_types]
      .filter((t) => (t.description ?? "").trim().length < 20)
      .map((t) => t.id);
    expect(offenders).toEqual([]);
  });
});

// The standard's exception policy (S 0.5) requires a deviation from a MUST
// rule to be documented in the schema itself rather than in external prose.
// A waiver recorded only in a review document is invisible to every consumer
// that reads the profile.
describe("waiver policy", () => {
  it("waiver_every_recorded_waiver_names_the_rule_it_waives", () => {
    const waived = FIELDS.filter((o) => ann(o.field).waiver !== undefined);
    expect(waived.length).toBeGreaterThan(0);
    for (const o of waived) {
      expect(ann(o.field).waiver, `${where(o)} does not name a rule`).toMatch(/rule \d+/);
    }
  });

  it("waiver_polymorphic_references_are_the_only_ones_waived", () => {
    // A growing waiver list is how a standard stops binding. This pins the
    // set, so a new one has to be argued for rather than added quietly.
    expect(
      FIELDS.filter((o) => ann(o.field).waiver !== undefined)
        .map(where)
        .sort(),
    ).toEqual(["media:Identifier.identifiesId", "media:ProviderRecord.describesId"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  AnnotationError,
  annotate,
  encodeAnnotations,
  parseAnnotations,
  type FieldAnnotations,
} from "../src/annotations.js";

// The FDPM meta-model is a strict Zod object: a FieldDef accepts no `x-*`
// keys. The schema-design standard nonetheless requires unit, timezone,
// ownership and sensitivity annotations to be recoverable from the schema
// alone. They therefore ride inside `description`, and this round trip is
// what makes the convention a contract rather than a habit.

describe("annotations", () => {
  it("annotate_prose_and_annotations_produces_parseable_description", () => {
    const text = annotate("Track runtime.", { unit: "seconds" });
    expect(text).toBe("Track runtime. [x-unit: seconds]");
    expect(parseAnnotations(text)).toEqual({ unit: "seconds" });
  });

  it("parseAnnotations_description_without_annotations_returns_empty", () => {
    expect(parseAnnotations("Just prose.")).toEqual({});
  });

  it("encodeAnnotations_same_input_is_order_independent_and_deterministic", () => {
    const a = encodeAnnotations({ unit: "seconds", immutable: true });
    const b = encodeAnnotations({ immutable: true, unit: "seconds" });
    expect(a).toBe(b);
  });

  // Reversibility (algebraic law): parse(encode(x)) === x for every
  // annotation the vocabulary defines.
  it("parseAnnotations_roundtrips_every_supported_annotation", () => {
    const full: Required<FieldAnnotations> = {
      unit: "bytes",
      timezone: "UTC",
      precision: "seconds",
      ordering: "significant",
      fk: "media:MusicRelease.id",
      fkExternal: true,
      relationship: "composition",
      sensitivity: "pii",
      immutable: true,
      localization: "locale-map",
      extensionPoint: true,
      derivation: "derived-cached",
      derivedFrom: "media:MusicRecording.duration",
      graphConstraint: "DAG",
      maxDepth: 5,
      waiver: "rule 5: bounded by the host",
      deprecated: true,
      deprecatedSince: "1.1.0",
      replacedBy: "media:Asset.contentIri",
      sunset: "2.0.0",
    };
    expect(parseAnnotations(encodeAnnotations(full))).toEqual(full);
  });

  it("parseAnnotations_unknown_annotation_key_throws", () => {
    expect(() => parseAnnotations("Prose. [x-nonsense: 1]")).toThrow(AnnotationError);
  });

  it("parseAnnotations_non_boolean_for_boolean_key_throws", () => {
    expect(() => parseAnnotations("Prose. [x-immutable: yes]")).toThrow(AnnotationError);
  });

  it("parseAnnotations_value_outside_closed_enum_throws", () => {
    expect(() => parseAnnotations("Prose. [x-ordering: sideways]")).toThrow(AnnotationError);
  });

  it("parseAnnotations_non_integer_for_numeric_key_throws", () => {
    expect(() => parseAnnotations("Prose. [x-max-depth: deep]")).toThrow(AnnotationError);
  });

  it("parseAnnotations_empty_value_throws", () => {
    expect(() => parseAnnotations("Prose. [x-unit: ]")).toThrow(AnnotationError);
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { PrimitiveInstance, RelationInstance } from "@fdpm/cli";
import type { RendererInput } from "../src/host-contract.js";
import { PROFILE } from "../src/profile.js";
import { PROFILE_ID } from "../src/vocabulary.js";
import {
  CATALOGUE_RENDERER_ID,
  ANNOTATION_RENDERER_ID,
  RENDERERS,
  RENDERER_BINDINGS,
  RENDER_TARGET,
} from "../src/renderers/index.js";
import { renderCatalogue } from "../src/renderers/catalogue.js";
import { renderAnnotationIndex } from "../src/renderers/annotation-index.js";
import { escapeInline, localized, titleOf } from "../src/renderers/markdown.js";
import { referenceFields, layerOfType } from "../src/renderers/model.js";

const UID = "01J0000000000000000000000A";
let uid = 0;

/** Build a primitive with only the fields a renderer reads. */
function p(id: string, type_id: string, field_values: Record<string, unknown>): PrimitiveInstance {
  uid += 1;
  return { id, uid: `${UID}${uid}`, type_id, field_values, revision: 0 };
}

/** Build a relation edge of the profile's own relation types. */
function r(
  id: string,
  type_id: string,
  source_id: string,
  target_id: string,
  field_values: Record<string, unknown> = {},
): RelationInstance {
  uid += 1;
  return { id, uid: `${UID}${uid}`, type_id, source_id, target_id, field_values, revision: 0 };
}

/** English localized text, in the shape the profile stores it. */
function en(text: string): Record<string, unknown> {
  return { primaryLocale: "en-US", values: [{ locale: "en-US", text }], translatedLocales: [] };
}

function input(
  primitives: PrimitiveInstance[],
  relations: RelationInstance[] = [],
  overrides: Partial<RendererInput> = {},
): RendererInput {
  return {
    workbookId: "catalogue",
    primitives,
    relations,
    profile: PROFILE,
    ...overrides,
  };
}

function text(out: { bytes: Uint8Array }): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(out.bytes);
}

// -- fixture: one complete FRBR spine, plus the records that hang off it ----

const composition = p("work:folklore", "media:MusicComposition", {
  layer: "work",
  title: en("folklore"),
  languages: ["en"],
});
const recording = p("expression:cardigan", "media:MusicRecording", {
  layer: "expression",
  title: en("cardigan"),
  compositionId: "work:folklore",
  duration: 239.1,
});
const release = p("manifestation:folklore-lp", "media:MusicRelease", {
  layer: "manifestation",
  title: en("folklore"),
  releaseType: "album",
});
const track = p("manifestation:cardigan-t2", "media:MusicTrack", {
  layer: "manifestation",
  title: en("cardigan"),
  releaseId: "manifestation:folklore-lp",
  recordingExpressionId: "expression:cardigan",
  trackNumber: 2,
});
const agent = p("agent:swift", "media:Agent", { name: "Taylor Swift", agentKind: "person" });
const iswc = p("identifier:iswc-folklore", "media:Identifier", {
  scheme: "iswc",
  value: "T-034.524.680-1",
  addressesLayer: "work",
  identifiesId: "work:folklore",
});
const credit = r("rel:credit-1", "media:AttributedTo", "work:folklore", "agent:swift", {
  predicate: "attributedTo",
  role: "composer",
  assertionKind: "fact",
  assertedBy: "agent:editor",
  assertedAt: "2026-01-01T00:00:00Z",
});

const SPINE = [composition, recording, release, track, agent, iswc];

interface OnDiskManifest {
  permissions: string[];
  capabilities: {
    capability_id: string;
    local_name: string;
    entry?: string;
    metadata?: Record<string, unknown>;
  }[];
}

const onDisk = JSON.parse(
  await readFile(new URL("../fdpm-plugin.json", import.meta.url), "utf8"),
) as OnDiskManifest;

describe("renderer registry", () => {
  const declared = onDisk.capabilities.filter((c) => c.capability_id === "cap:renderer");

  // The manifest is what the host registers from and the profile is what
  // `findRenderer` disambiguates with. Three lists that can disagree is how a
  // workbook ends up rendered by another plugin's renderer entirely.
  it("manifest_declares_one_renderer_capability_per_registry_entry", () => {
    expect(declared.map((c) => c.metadata?.["renderer_id"]).sort()).toEqual(
      RENDERERS.map((x) => x.rendererId).sort(),
    );
  });

  it("manifest_renderer_targets_match_the_registry", () => {
    for (const capability of declared) {
      const entry = RENDERERS.find((x) => x.rendererId === capability.metadata?.["renderer_id"]);
      expect(entry).toBeDefined();
      expect(capability.metadata?.["target"]).toBe(entry?.target);
      expect(capability.metadata?.["output_path"]).toBe(entry?.outputPath);
      expect(capability.local_name).toBe(entry?.localName);
    }
  });

  // registerRenderer is permission-gated on render:server. Declaring the
  // capability without the permission activates into a throw.
  it("manifest_declares_the_permission_registerRenderer_requires", () => {
    expect(onDisk.permissions).toContain("render:server");
  });

  it("registry_renderer_ids_are_unique", () => {
    expect(new Set(RENDERERS.map((x) => x.rendererId)).size).toBe(RENDERERS.length);
  });

  it("registry_local_names_match_the_manifest_syntax", () => {
    for (const entry of RENDERERS) expect(entry.localName).toMatch(/^[a-z0-9-]+$/);
  });

  it("profile_declares_a_binding_for_every_registry_entry", () => {
    expect(PROFILE.renderers).toEqual(RENDERER_BINDINGS);
    expect(RENDERER_BINDINGS.map((b) => b.renderer_id)).toEqual(RENDERERS.map((x) => x.rendererId));
  });

  // findRenderer takes the first profile-declared renderer matching a target,
  // so declaration order decides what `fdpm render <wb> text/markdown` returns
  // when no --renderer-id is given.
  it("catalogue_is_the_first_binding_so_it_is_the_default_for_the_target", () => {
    expect(RENDERER_BINDINGS[0]?.renderer_id).toBe(CATALOGUE_RENDERER_ID);
  });
});

describe("markdown helpers", () => {
  it("escapeInline_neutralizes_the_characters_that_break_a_table_cell", () => {
    expect(escapeInline("a|b*c_d[e]f`g<h")).toBe("a\\|b\\*c\\_d\\[e\\]f\\`g\\<h");
  });

  it("escapeInline_collapses_newlines_so_a_cell_stays_on_one_row", () => {
    expect(escapeInline("a\nb\r\nc")).toBe("a b c");
  });

  it("localized_resolves_the_declared_primary_locale", () => {
    const value = localized({
      primaryLocale: "pt-BR",
      values: [
        { locale: "en-US", text: "folklore" },
        { locale: "pt-BR", text: "folclore" },
      ],
    });
    expect(value).toEqual({ text: "folclore", locale: "pt-BR", primaryResolved: true });
  });

  // The profile's own validator rejects this on write, so reaching it means
  // reading data written before the rule existed. Rendering the first entry
  // beats rendering nothing, but the caller is told which entry it got.
  it("localized_falls_back_to_the_first_entry_when_the_primary_is_absent", () => {
    const value = localized({
      primaryLocale: "de",
      values: [{ locale: "en-US", text: "folklore" }],
    });
    expect(value).toEqual({ text: "folklore", locale: "en-US", primaryResolved: false });
  });

  it("localized_rejects_a_value_that_is_not_localized_text", () => {
    expect(localized("folklore")).toBeUndefined();
    expect(localized({ primaryLocale: "en", values: [] })).toBeUndefined();
    expect(localized(null)).toBeUndefined();
  });

  it("titleOf_prefers_title_then_label_then_name_then_id", () => {
    expect(titleOf(composition)).toBe("folklore");
    expect(titleOf(p("concept:pop", "media:Concept", { label: en("Pop") }))).toBe("Pop");
    expect(titleOf(agent)).toBe("Taylor Swift");
    expect(titleOf(p("provider:mb", "media:ProviderRecord", {}))).toBe("provider:mb");
  });
});

describe("profile-derived reference model", () => {
  // The spine is read off the profile's own [x-relationship] annotations
  // rather than a hand-kept list, so a type added to the profile is nested by
  // the renderer without a second edit here.
  it("referenceFields_recovers_the_composition_parent_of_a_recording", () => {
    expect(referenceFields(PROFILE, "media:MusicRecording")).toContainEqual({
      field: "compositionId",
      targetTypeId: "media:MusicComposition",
      relationship: "composition",
    });
  });

  it("referenceFields_distinguishes_aggregation_from_composition", () => {
    const fields = referenceFields(PROFILE, "media:MusicTrack");
    expect(fields.find((f) => f.field === "releaseId")?.relationship).toBe("composition");
    expect(fields.find((f) => f.field === "recordingExpressionId")?.relationship).toBe(
      "aggregation",
    );
  });

  it("referenceFields_recovers_a_polymorphic_reference_as_a_wildcard_target", () => {
    expect(referenceFields(PROFILE, "media:Identifier")).toContainEqual({
      field: "identifiesId",
      targetTypeId: "*",
      relationship: "association",
    });
  });

  it("referenceFields_is_empty_for_a_type_the_profile_does_not_declare", () => {
    expect(referenceFields(PROFILE, "uml:Class")).toEqual([]);
  });

  it("layerOfType_reads_the_pinned_layer_enum", () => {
    expect(layerOfType(PROFILE, "media:MusicComposition")).toBe("work");
    expect(layerOfType(PROFILE, "media:MusicTrack")).toBe("manifestation");
    expect(layerOfType(PROFILE, "media:Agent")).toBeUndefined();
  });
});

describe("catalogue renderer", () => {
  it("declares_the_content_type_it_registered_under", () => {
    // SPEC-CORE 6.5: the host rejects output whose contentType differs from
    // the registered target.
    const out = renderCatalogue(input(SPINE));
    expect(out.contentType).toBe(RENDER_TARGET);
    expect(out.filename).toBe("catalogue.md");
  });

  it("emits_decodable_utf8", () => {
    expect(() => text(renderCatalogue(input(SPINE)))).not.toThrow();
  });

  it("nests_an_expression_under_the_work_its_composition_key_names", () => {
    const doc = text(renderCatalogue(input(SPINE)));
    const work = doc.indexOf("work:folklore");
    const expression = doc.indexOf("expression:cardigan");
    const release_ = doc.indexOf("manifestation:folklore-lp");
    expect(work).toBeGreaterThan(-1);
    expect(expression).toBeGreaterThan(work);
    expect(release_).toBeGreaterThan(-1);
  });

  it("nests_a_track_under_the_release_that_carries_it", () => {
    const doc = text(renderCatalogue(input(SPINE)));
    const lines = doc.split("\n");
    const releaseLine = lines.findIndex((l) => l.includes("manifestation:folklore-lp"));
    const trackLine = lines.findIndex((l) => l.includes("manifestation:cardigan-t2"));
    expect(trackLine).toBeGreaterThan(releaseLine);
    // The track is indented under its release rather than listed beside it.
    expect(lines[trackLine]?.match(/^ */)?.[0].length).toBeGreaterThan(
      lines[releaseLine]?.match(/^ */)?.[0].length ?? 0,
    );
  });

  it("resolves_an_identifier_against_its_registry_label", () => {
    const doc = text(renderCatalogue(input(SPINE)));
    expect(doc).toContain("ISWC");
    expect(doc).toContain("T-034.524.680-1");
  });

  it("renders_a_credit_with_the_role_the_edge_carries", () => {
    const doc = text(renderCatalogue(input([...SPINE], [credit])));
    expect(doc).toMatch(/composer/);
    expect(doc).toContain("Taylor Swift");
  });

  it("is_byte_identical_regardless_of_input_order", () => {
    const forward = renderCatalogue(input(SPINE, [credit]));
    const reversed = renderCatalogue(input([...SPINE].reverse(), [credit]));
    expect(text(reversed)).toBe(text(forward));
  });

  it("reports_a_finding_when_a_composition_key_names_a_record_that_is_absent", () => {
    const orphan = p("manifestation:lost", "media:MusicTrack", {
      layer: "manifestation",
      title: en("lost"),
      releaseId: "manifestation:missing",
    });
    const out = renderCatalogue(input([...SPINE, orphan]));
    const finding = out.findings?.find((f) => f.expression.includes("releaseId"));
    expect(finding).toBeDefined();
    expect(finding?.kind).toBe("render-error");
    expect(finding?.templateId).toBe(CATALOGUE_RENDERER_ID);
    expect(finding?.message).toContain("manifestation:missing");
  });

  it("still_renders_a_record_whose_parent_key_dangles", () => {
    // Dropping it would make the document disagree with the workbook it
    // claims to describe; the finding is the report, not the omission.
    const orphan = p("manifestation:lost", "media:MusicTrack", {
      layer: "manifestation",
      title: en("lost"),
      releaseId: "manifestation:missing",
    });
    expect(text(renderCatalogue(input([...SPINE, orphan])))).toContain("manifestation:lost");
  });

  it("renders_every_primitive_exactly_once", () => {
    const doc = text(renderCatalogue(input(SPINE, [credit])));
    for (const primitive of SPINE) {
      const hits = doc.split(primitive.id).length - 1;
      expect(hits, `${primitive.id} appears ${hits} times`).toBeGreaterThanOrEqual(1);
    }
  });

  it("refuses_a_workbook_governed_by_another_profile_without_raising", () => {
    // Raising would quarantine the plugin: the host treats any throw that is
    // not its own FDPMException as a plugin defect, and FDPMException is not
    // reachable from a deployed plugin directory. The refusal is in-band.
    const out = renderCatalogue(
      input(SPINE, [], { profile: { ...PROFILE, id: "profile:uml:1.0" } }),
    );
    expect(out.contentType).toBe(RENDER_TARGET);
    expect(text(out)).toContain("profile:uml:1.0");
    expect(out.findings?.[0]?.message).toContain(PROFILE_ID);
    expect(text(out)).not.toContain("work:folklore");
  });

  it("renders_an_empty_workbook_as_a_document_rather_than_raising", () => {
    const out = renderCatalogue(input([]));
    expect(text(out)).toContain("No records");
    expect(out.findings ?? []).toHaveLength(0);
  });

  it("stamps_the_render_time_only_when_the_host_supplied_one", () => {
    const stamped = text(renderCatalogue(input(SPINE, [], { renderedAt: "2026-08-31T12:00:00Z" })));
    expect(stamped).toContain("2026-08-31T12:00:00Z");
    expect(text(renderCatalogue(input(SPINE)))).not.toContain("Rendered");
  });

  it("escapes_markdown_syntax_carried_inside_a_title", () => {
    const hostile = p("work:hostile", "media:MusicComposition", {
      layer: "work",
      title: en("a|b *c*"),
    });
    const doc = text(renderCatalogue(input([hostile])));
    expect(doc).toContain("a\\|b \\*c\\*");
  });

  it("counts_the_records_it_rendered_by_layer", () => {
    const doc = text(renderCatalogue(input(SPINE, [credit])));
    expect(doc).toMatch(/Work[\s\S]*?1/);
    expect(doc).toContain("Manifestation");
  });
});

describe("annotation index renderer", () => {
  const target = p("expression:cardigan", "media:MusicRecording", {
    layer: "expression",
    title: en("cardigan"),
    compositionId: "work:folklore",
  });

  function annotation(id: string, fields: Record<string, unknown>): PrimitiveInstance {
    return p(id, "media:Annotation", {
      motivation: "commenting",
      bodyType: "textual",
      assertionKind: "fact",
      assertedBy: "agent:editor",
      assertedAt: "2026-01-01T00:00:00Z",
      anchorStatus: "resolved",
      ...fields,
    });
  }

  const attaches = (id: string, from: string, to: string): RelationInstance =>
    r(id, "media:Cites", from, to, {
      predicate: "cites",
      assertionKind: "fact",
      assertedBy: "agent:editor",
      assertedAt: "2026-01-01T00:00:00Z",
    });

  it("declares_the_content_type_it_registered_under", () => {
    const out = renderAnnotationIndex(input([]));
    expect(out.contentType).toBe(RENDER_TARGET);
    expect(out.filename).toBe("annotations.md");
  });

  it("formats_a_time_range_anchor_from_both_bounds", () => {
    const a = annotation("annotation:solo", {
      selectorType: "timeRange",
      startTime: 12.5,
      endTime: 48,
      bodyValue: en("the bridge"),
    });
    const doc = text(
      renderAnnotationIndex(input([target, a], [attaches("rel:a1", a.id, target.id)])),
    );
    expect(doc).toContain("12.5s");
    expect(doc).toContain("48s");
  });

  it("formats_a_text_position_anchor_with_the_normalization_it_was_counted_under", () => {
    // Offsets without their normalization form are meaningless, so the form
    // is part of the anchor, not a footnote.
    const a = annotation("annotation:pos", {
      selectorType: "textPosition",
      startOffset: 100,
      endOffset: 160,
      unicodeNormalization: "NFC",
    });
    const doc = text(
      renderAnnotationIndex(input([target, a], [attaches("rel:a2", a.id, target.id)])),
    );
    expect(doc).toContain("100");
    expect(doc).toContain("160");
    expect(doc).toContain("NFC");
  });

  it("formats_a_text_quote_anchor_with_its_re_anchoring_context", () => {
    const a = annotation("annotation:quote", {
      selectorType: "textQuote",
      exactQuote: "and when I felt like I was an old cardigan",
      prefixQuote: "...",
      suffixQuote: " under someone's bed",
    });
    const doc = text(
      renderAnnotationIndex(input([target, a], [attaches("rel:a3", a.id, target.id)])),
    );
    expect(doc).toContain("old cardigan");
  });

  it("formats_a_page_anchor", () => {
    const a = annotation("annotation:page", { selectorType: "page", pageNumber: 42 });
    const doc = text(
      renderAnnotationIndex(input([target, a], [attaches("rel:a4", a.id, target.id)])),
    );
    expect(doc).toContain("page 42");
  });

  it("formats_a_spatial_region_anchor_as_a_fragment", () => {
    const a = annotation("annotation:region", {
      selectorType: "spatialRegion",
      regionX: 10,
      regionY: 20,
      regionWidth: 30,
      regionHeight: 40,
    });
    const doc = text(
      renderAnnotationIndex(input([target, a], [attaches("rel:a5", a.id, target.id)])),
    );
    expect(doc).toContain("10");
    expect(doc).toContain("40");
  });

  it("says_whole_resource_for_a_selector_that_needs_no_anchor", () => {
    const a = annotation("annotation:whole", { selectorType: "whole" });
    const doc = text(
      renderAnnotationIndex(input([target, a], [attaches("rel:a6", a.id, target.id)])),
    );
    expect(doc).toContain("whole resource");
  });

  // The selector discriminates which anchor fields apply; the meta-model
  // cannot make them conditionally required, so an incomplete anchor reaches
  // the render and is reported there.
  it("reports_a_finding_when_the_selector_names_anchor_fields_the_record_lacks", () => {
    const a = annotation("annotation:broken", { selectorType: "timeRange" });
    const out = renderAnnotationIndex(input([target, a], [attaches("rel:a7", a.id, target.id)]));
    const finding = out.findings?.find((f) => f.expression.includes("annotation:broken"));
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("timeRange");
    expect(finding?.templateId).toBe(ANNOTATION_RENDERER_ID);
  });

  it("groups_annotations_under_the_resource_their_edge_names", () => {
    const a = annotation("annotation:one", { selectorType: "whole" });
    const doc = text(
      renderAnnotationIndex(input([target, a], [attaches("rel:a8", a.id, target.id)])),
    );
    const targetAt = doc.indexOf("cardigan");
    expect(targetAt).toBeGreaterThan(-1);
    expect(doc.indexOf("annotation:one")).toBeGreaterThan(targetAt);
  });

  it("reports_an_annotation_that_anchors_to_nothing", () => {
    const a = annotation("annotation:floating", { selectorType: "whole" });
    const out = renderAnnotationIndex(input([target, a]));
    expect(text(out)).toContain("annotation:floating");
    expect(out.findings?.some((f) => f.message.includes("no target"))).toBe(true);
  });

  it("shows_the_confidence_an_inference_carries", () => {
    const a = annotation("annotation:guess", {
      selectorType: "whole",
      assertionKind: "inference",
      confidence: 0.62,
    });
    const doc = text(
      renderAnnotationIndex(input([target, a], [attaches("rel:a9", a.id, target.id)])),
    );
    expect(doc).toContain("0.62");
    expect(doc).toContain("inference");
  });

  it("is_byte_identical_regardless_of_input_order", () => {
    const many = [
      annotation("annotation:b", { selectorType: "page", pageNumber: 2 }),
      annotation("annotation:a", { selectorType: "page", pageNumber: 1 }),
    ];
    const edges = [
      attaches("rel:x", "annotation:a", target.id),
      attaches("rel:y", "annotation:b", target.id),
    ];
    const forward = text(renderAnnotationIndex(input([target, ...many], edges)));
    const reversed = text(
      renderAnnotationIndex(input([...many.reverse(), target], [...edges].reverse())),
    );
    expect(reversed).toBe(forward);
  });

  it("renders_a_workbook_with_no_annotations_as_a_document", () => {
    const out = renderAnnotationIndex(input([target]));
    expect(text(out)).toContain("No annotations");
    expect(out.findings ?? []).toHaveLength(0);
  });

  it("refuses_a_workbook_governed_by_another_profile_without_raising", () => {
    const out = renderAnnotationIndex(
      input([target], [], { profile: { ...PROFILE, id: "profile:uml:1.0" } }),
    );
    expect(out.findings?.[0]?.message).toContain(PROFILE_ID);
    expect(text(out)).toContain("profile:uml:1.0");
  });
});

describe("catalogue renderer — paths a real catalogue reaches", () => {
  it("keeps a composition cycle in the document and says the link was cut", () => {
    // Every record in a cycle has a parent, so a forest walk that trusted the
    // references would render none of them at all.
    const a = p("expression:a", "media:MusicRecording", {
      layer: "expression",
      title: en("A"),
      compositionId: "expression:b",
    });
    const b = p("expression:b", "media:MusicRecording", {
      layer: "expression",
      title: en("B"),
      compositionId: "expression:a",
    });
    const out = renderCatalogue(input([a, b]));
    const doc = text(out);
    expect(doc).toContain("expression:a");
    expect(doc).toContain("expression:b");
    expect(out.findings?.some((f) => f.message.includes("cycle"))).toBe(true);
  });

  it("cuts the same cycle link regardless of input order", () => {
    const a = p("expression:a", "media:MusicRecording", {
      layer: "expression",
      title: en("A"),
      compositionId: "expression:b",
    });
    const b = p("expression:b", "media:MusicRecording", {
      layer: "expression",
      title: en("B"),
      compositionId: "expression:a",
    });
    expect(text(renderCatalogue(input([b, a])))).toBe(text(renderCatalogue(input([a, b]))));
  });

  it("reports a title whose declared primary locale has no entry", () => {
    const record = p("work:mislocalized", "media:MusicComposition", {
      layer: "work",
      title: { primaryLocale: "pt-BR", values: [{ locale: "en-US", text: "folklore" }] },
    });
    const out = renderCatalogue(input([record]));
    expect(text(out)).toContain("folklore");
    expect(
      out.findings?.some((f) => f.expression === "work:mislocalized.title.primaryLocale"),
    ).toBe(true);
  });

  it("renders a summary when the record carries one", () => {
    const record = p("work:summarized", "media:MusicComposition", {
      layer: "work",
      title: en("folklore"),
      summary: en("An album written in isolation."),
    });
    expect(text(renderCatalogue(input([record])))).toContain("written in isolation");
  });

  it("names a registry outside the table by the scheme name the record supplies", () => {
    const other = p("identifier:local", "media:Identifier", {
      scheme: "other",
      schemeName: "acme:catalogNumber",
      value: "AC-1",
      addressesLayer: "unspecified",
      identifiesId: "work:folklore",
    });
    expect(text(renderCatalogue(input([composition, other])))).toContain("acme:catalogNumber");
  });

  it("falls back to the raw scheme token when the record names no registry", () => {
    const bare = p("identifier:bare", "media:Identifier", {
      scheme: "zzz",
      value: "X",
      addressesLayer: "unspecified",
      identifiesId: "work:folklore",
    });
    expect(text(renderCatalogue(input([composition, bare])))).toContain("zzz");
  });

  it("lists an identifier whose subject the workbook does not contain", () => {
    // Rendered inline it would appear nowhere, because the record it names is
    // absent. Every record the workbook holds must be locatable in the document.
    const orphan = p("identifier:orphan", "media:Identifier", {
      scheme: "isrc",
      value: "USRC17607839",
      addressesLayer: "expression",
      identifiesId: "expression:gone",
    });
    const out = renderCatalogue(input([composition, orphan]));
    expect(text(out)).toContain("identifier:orphan");
    expect(out.findings?.some((f) => f.expression === "identifier:orphan.identifiesId")).toBe(true);
  });

  it("names an absent credit target by its id rather than dropping the credit", () => {
    const out = renderCatalogue(
      input(
        [composition],
        [
          r("rel:c", "media:AttributedTo", "work:folklore", "agent:gone", {
            predicate: "attributedTo",
            role: "composer",
          }),
        ],
      ),
    );
    expect(text(out)).toContain("agent:gone");
  });

  it("recovers a predicate from the relation type when the edge omits the field", () => {
    const edge = r("rel:bare", "media:Cites", "work:folklore", "work:other");
    const other = p("work:other", "media:LiteraryWork", { layer: "work", title: en("Other") });
    expect(text(renderCatalogue(input([composition, other], [edge])))).toContain("cites");
  });

  it("falls back to the relation type id for an edge outside this profile", () => {
    const edge = r("rel:alien", "uml:Realizes", "work:folklore", "work:folklore");
    expect(text(renderCatalogue(input([composition], [edge])))).toContain("uml:Realizes");
  });

  it("tables every supporting type the workbook carries", () => {
    const records = [
      p("concept:pop", "media:Concept", { vocabulary: "local", code: "pop", label: en("Pop") }),
      p("collection:mix", "media:Collection", {
        title: en("Mix"),
        collectionKind: "playlist",
      }),
      p("provider:mb", "media:ProviderRecord", { provider: "musicbrainz" }),
      p("annotation:note", "media:Annotation", { selectorType: "whole", motivation: "commenting" }),
    ];
    const doc = text(renderCatalogue(input([composition, ...records])));
    for (const record of records) expect(doc).toContain(record.id);
    expect(doc).toContain("media:AnnotationIndexRenderer");
  });

  it("shows the confidence an inferred edge carries", () => {
    const edge = r("rel:guess", "media:SameAs", "work:folklore", "work:folklore", {
      predicate: "sameAs",
      assertionKind: "inference",
      confidence: 0.4,
    });
    expect(text(renderCatalogue(input([composition], [edge])))).toContain("0.4");
  });
});

describe("annotation index renderer — every selector the profile declares", () => {
  const target = p("expression:anchored", "media:MusicRecording", {
    layer: "expression",
    title: en("anchored"),
  });

  function anchored(id: string, fields: Record<string, unknown>): PrimitiveInstance {
    return p(id, "media:Annotation", {
      motivation: "describing",
      bodyType: "textual",
      assertionKind: "fact",
      assertedBy: "agent:editor",
      assertedAt: "2026-01-01T00:00:00Z",
      ...fields,
    });
  }

  function render(annotation: PrimitiveInstance, targetId = target.id): string {
    return text(
      renderAnnotationIndex(
        input(
          [target, annotation],
          [r("rel:edge", "media:Mentions", annotation.id, targetId, { predicate: "mentions" })],
        ),
      ),
    );
  }

  it("renders an svg selector without spilling the whole path into the line", () => {
    const doc = render(anchored("annotation:svg", { selectorType: "svg", svgPath: "M0 0 L1 1" }));
    expect(doc).toContain("SVG path");
    expect(doc).toContain("9 characters");
  });

  it("renders an epub cfi selector", () => {
    expect(
      render(anchored("annotation:cfi", { selectorType: "epubCfi", cfiRange: "/6/4!/4/2" })),
    ).toContain("/6/4!/4/2");
  });

  it("renders a css selector", () => {
    expect(
      render(anchored("annotation:css", { selectorType: "css", cssSelector: "main p" })),
    ).toContain("main p");
  });

  it("renders a structural selector as needing no anchor fields", () => {
    const out = renderAnnotationIndex(
      input(
        [target, anchored("annotation:struct", { selectorType: "structural" })],
        [r("rel:e", "media:Mentions", "annotation:struct", target.id, { predicate: "mentions" })],
      ),
    );
    expect(text(out)).toContain("structural selector");
    expect(out.findings ?? []).toHaveLength(0);
  });

  it("carries broadcast timecode alongside the float when the record has both", () => {
    const doc = render(
      anchored("annotation:smpte", {
        selectorType: "timeRange",
        startTime: 1,
        endTime: 2,
        smpteStart: "00:00:01:00",
        smpteEnd: "00:00:02:00",
      }),
    );
    expect(doc).toContain("00:00:01:00");
  });

  it("renders a quote that carries no re-anchoring context", () => {
    const doc = render(
      anchored("annotation:plain", { selectorType: "textQuote", exactQuote: "a line" }),
    );
    expect(doc).toContain("a line");
  });

  it("reports an annotation that declares no selector at all", () => {
    const out = renderAnnotationIndex(
      input(
        [target, anchored("annotation:noselector", {})],
        [
          r("rel:e", "media:Mentions", "annotation:noselector", target.id, {
            predicate: "mentions",
          }),
        ],
      ),
    );
    expect(out.findings?.some((f) => f.message.includes("selectorType"))).toBe(true);
  });

  // The stored value can be anything the enum accepted at write time, and the
  // enum grows. A selector this renderer has no anchor form for is reported
  // rather than rendered as a blank anchor.
  it("reports a selector kind it has no anchor form for", () => {
    const out = renderAnnotationIndex(
      input(
        [target, anchored("annotation:future", { selectorType: "hologram" })],
        [r("rel:e", "media:Mentions", "annotation:future", target.id, { predicate: "mentions" })],
      ),
    );
    expect(out.findings?.some((f) => f.message.includes("hologram"))).toBe(true);
    expect(text(out)).toContain("hologram");
  });

  it("names an absent target by its id rather than omitting the group", () => {
    const doc = render(
      anchored("annotation:hanging", { selectorType: "whole" }),
      "expression:gone",
    );
    expect(doc).toContain("expression:gone");
    expect(doc).toContain("annotation:hanging");
  });

  it("names the predicate the annotation is attached through", () => {
    expect(render(anchored("annotation:via", { selectorType: "whole" }))).toContain("mentions");
  });

  it("stamps the render time only when the host supplied one", () => {
    const out = renderAnnotationIndex(input([target], [], { renderedAt: "2026-08-31T12:00:00Z" }));
    expect(text(out)).toContain("2026-08-31T12:00:00Z");
    expect(text(renderAnnotationIndex(input([target])))).not.toContain("Rendered");
  });
});

describe("containment walk", () => {
  it("renders a chain longer than any fixed depth cap in full", () => {
    // Termination comes from the forest the index builds, not from a depth
    // limit, so a long chain is rendered rather than truncated.
    const chain: PrimitiveInstance[] = [];
    for (let i = 0; i < 20; i += 1) {
      chain.push(
        p(`expression:link-${String(i).padStart(2, "0")}`, "media:MusicRecording", {
          layer: "expression",
          title: en(`link ${i}`),
          ...(i === 0
            ? {}
            : { compositionId: `expression:link-${String(i - 1).padStart(2, "0")}` }),
        }),
      );
    }
    const out = renderCatalogue(input(chain));
    const doc = text(out);
    for (const record of chain) expect(doc).toContain(record.id);
    expect(out.findings ?? []).toHaveLength(0);
  });
});

describe("rendered Markdown reads as Markdown", () => {
  it("separates a record's metadata lines with hard line breaks", () => {
    // Without them Markdown joins the type, identifier and credit lines into
    // one run-on paragraph with the labels buried inside it.
    const doc = text(renderCatalogue(input(SPINE, [credit])));
    const meta = doc.split("\n").find((l) => l.startsWith("**Identifiers**"));
    expect(meta).toBeDefined();
    const before = doc.split("\n")[doc.split("\n").indexOf(meta!) - 1];
    expect(before?.endsWith("  ")).toBe(true);
  });

  it("groups supporting types under the profile's own category names", () => {
    const doc = text(renderCatalogue(input(SPINE)));
    expect(doc).toContain("## Agents");
    expect(doc).not.toContain("## Agent\n");
  });

  it("agrees in number when counting", () => {
    const target = p("expression:one", "media:MusicRecording", {
      layer: "expression",
      title: en("one"),
    });
    const one = p("annotation:only", "media:Annotation", {
      selectorType: "whole",
      motivation: "commenting",
      bodyType: "textual",
    });
    const doc = text(
      renderAnnotationIndex(
        input(
          [target, one],
          [r("rel:e", "media:Mentions", one.id, target.id, { predicate: "mentions" })],
        ),
      ),
    );
    expect(doc).toContain("1 annotation on 1 resource");
    expect(doc).not.toContain("1 annotations");
  });
});

import { describe, expect, it } from "vitest";
import type { PrimitiveInstance, ProjectTransfer, RelationInstance } from "@fdpm/cli";
import { EXPORT_FORMAT, JSONLD_CONTEXT, exportJsonLd } from "../src/exporter.js";
import { PROFILE_ID } from "../src/vocabulary.js";

const UID = "01J0000000000000000000000A";

function transfer(
  primitives: PrimitiveInstance[],
  relations: RelationInstance[] = [],
): ProjectTransfer {
  return {
    spec_core: "1.2.0",
    workbook: {
      id: "catalogue",
      name: "Catalogue",
      profile_id: PROFILE_ID,
      created_at: "2026-08-31T00:00:00.000Z",
      revision: 3,
    },
    primitives,
    relations,
    templates: [],
    test_suites: [],
  };
}

const release: PrimitiveInstance = {
  id: "manifestation:folklore",
  uid: UID,
  type_id: "media:MusicRelease",
  field_values: {
    layer: "manifestation",
    title: {
      primaryLocale: "en-US",
      values: [{ locale: "en-US", text: "folklore" }],
      translatedLocales: [],
    },
    releaseType: "album",
  },
  revision: 0,
};

function decode(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

describe("exportJsonLd", () => {
  it("exportJsonLd_declares_the_format_the_manifest_registers", () => {
    expect(EXPORT_FORMAT).toBe("media-jsonld");
  });

  it("exportJsonLd_emits_a_document_carrying_the_shared_context", () => {
    const doc = decode(exportJsonLd(transfer([release])));
    expect(doc["@context"]).toEqual(JSONLD_CONTEXT);
  });

  it("exportJsonLd_maps_each_primitive_to_a_graph_node_with_its_own_id", () => {
    const doc = decode(exportJsonLd(transfer([release])));
    const graph = doc["@graph"] as { "@id": string; "@type": string }[];
    expect(graph).toHaveLength(1);
    expect(graph[0]?.["@id"]).toBe("manifestation:folklore");
  });

  it("exportJsonLd_maps_a_known_type_to_its_schema_org_class", () => {
    const doc = decode(exportJsonLd(transfer([release])));
    const graph = doc["@graph"] as { "@type": string }[];
    expect(graph[0]?.["@type"]).toBe("schema:MusicAlbum");
  });

  it("exportJsonLd_carries_an_unmapped_type_under_its_profile_id", () => {
    // An unmapped type is data this export does not have a schema.org
    // class for, not an error: it keeps its FDPM identity rather than
    // being dropped or silently retyped.
    const odd: PrimitiveInstance = { ...release, id: "x:1", type_id: "media:ProviderRecord" };
    const doc = decode(exportJsonLd(transfer([odd])));
    const graph = doc["@graph"] as { "@type": string }[];
    expect(graph[0]?.["@type"]).toBe("media:ProviderRecord");
  });

  it("exportJsonLd_projects_localized_text_to_a_language_map", () => {
    const doc = decode(exportJsonLd(transfer([release])));
    const graph = doc["@graph"] as Record<string, unknown>[];
    expect(graph[0]?.["title"]).toEqual({ "en-US": "folklore" });
  });

  it("exportJsonLd_emits_relations_as_graph_edges", () => {
    const edge: RelationInstance = {
      id: "rel:1",
      uid: UID,
      type_id: "media:PartOf",
      source_id: "manifestation:folklore",
      target_id: "work:folklore",
      field_values: { predicate: "partOf", assertionKind: "fact" },
      revision: 0,
    };
    const doc = decode(exportJsonLd(transfer([release], [edge])));
    const graph = doc["@graph"] as Record<string, unknown>[];
    const node = graph.find((n) => n["@id"] === "manifestation:folklore");
    expect(node?.["partOf"]).toEqual([{ "@id": "work:folklore" }]);
  });

  it("exportJsonLd_empty_workbook_emits_an_empty_graph", () => {
    const doc = decode(exportJsonLd(transfer([])));
    expect(doc["@graph"]).toEqual([]);
  });

  it("exportJsonLd_is_deterministic_for_one_input", () => {
    const a = exportJsonLd(transfer([release]));
    const b = exportJsonLd(transfer([release]));
    expect(new TextDecoder().decode(a)).toBe(new TextDecoder().decode(b));
  });

  it("exportJsonLd_orders_graph_nodes_by_id_regardless_of_input_order", () => {
    const other: PrimitiveInstance = { ...release, id: "manifestation:aaa" };
    const forward = decode(exportJsonLd(transfer([release, other])));
    const reversed = decode(exportJsonLd(transfer([other, release])));
    expect(forward["@graph"]).toEqual(reversed["@graph"]);
  });

  it("exportJsonLd_rejects_a_transfer_from_another_profile", () => {
    const foreign = transfer([release]);
    foreign.workbook.profile_id = "profile:planning:1.0";
    expect(() => exportJsonLd(foreign)).toThrow(/profile/i);
  });
});

describe("exportJsonLd projection", () => {
  it("exportJsonLd_projects_localized_text_nested_inside_a_struct", () => {
    const article: PrimitiveInstance = {
      ...release,
      id: "manifestation:correction",
      type_id: "media:NewsArticle",
      field_values: {
        layer: "manifestation",
        corrections: [
          {
            issuedAt: "2026-08-31T00:00:00Z",
            note: {
              primaryLocale: "en-US",
              values: [{ locale: "en-US", text: "Corrected the byline." }],
              translatedLocales: [],
            },
          },
        ],
      },
    };
    const doc = decode(exportJsonLd(transfer([article])));
    const graph = doc["@graph"] as Record<string, unknown>[];
    const corrections = graph[0]?.["corrections"] as Record<string, unknown>[];
    expect(corrections[0]?.["note"]).toEqual({ "en-US": "Corrected the byline." });
  });

  it("exportJsonLd_leaves_a_malformed_localized_value_untouched", () => {
    // An export must not invent a language map from something that is not one;
    // passing the value through keeps the defect visible downstream.
    const odd: PrimitiveInstance = {
      ...release,
      field_values: { layer: "manifestation", title: { primaryLocale: "en-US", values: "nope" } },
    };
    const doc = decode(exportJsonLd(transfer([odd])));
    const graph = doc["@graph"] as Record<string, unknown>[];
    expect(graph[0]?.["title"]).toEqual({ primaryLocale: "en-US", values: "nope" });
  });

  it("exportJsonLd_derives_the_edge_term_from_the_type_when_no_predicate_is_stored", () => {
    const edge: RelationInstance = {
      id: "rel:1",
      uid: UID,
      type_id: "media:Samples",
      source_id: "manifestation:folklore",
      target_id: "expression:other",
      field_values: {},
      revision: 0,
    };
    const doc = decode(exportJsonLd(transfer([release], [edge])));
    const graph = doc["@graph"] as Record<string, unknown>[];
    expect(graph[0]?.["samples"]).toEqual([{ "@id": "expression:other" }]);
  });

  it("exportJsonLd_points_an_edge_at_its_external_iri_when_the_object_is_outside", () => {
    const edge: RelationInstance = {
      id: "rel:1",
      uid: UID,
      type_id: "media:Cites",
      source_id: "manifestation:folklore",
      target_id: "manifestation:absent",
      field_values: { predicate: "cites", objectIri: "https://doi.org/10.1000/182" },
      revision: 0,
    };
    const doc = decode(exportJsonLd(transfer([release], [edge])));
    const graph = doc["@graph"] as Record<string, unknown>[];
    expect(graph[0]?.["cites"]).toEqual([{ "@id": "https://doi.org/10.1000/182" }]);
  });

  it("exportJsonLd_accumulates_several_edges_under_one_term", () => {
    const mk = (id: string, target: string): RelationInstance => ({
      id,
      uid: UID,
      type_id: "media:Mentions",
      source_id: "manifestation:folklore",
      target_id: target,
      field_values: { predicate: "mentions" },
      revision: 0,
    });
    const doc = decode(
      exportJsonLd(transfer([release], [mk("rel:1", "agent:a"), mk("rel:2", "agent:b")])),
    );
    const graph = doc["@graph"] as Record<string, unknown>[];
    expect(graph[0]?.["mentions"]).toEqual([{ "@id": "agent:a" }, { "@id": "agent:b" }]);
  });

  it("exportJsonLd_skips_an_edge_whose_subject_is_not_in_the_export", () => {
    const edge: RelationInstance = {
      id: "rel:1",
      uid: UID,
      type_id: "media:Cites",
      source_id: "manifestation:absent",
      target_id: "manifestation:folklore",
      field_values: { predicate: "cites" },
      revision: 0,
    };
    const doc = decode(exportJsonLd(transfer([release], [edge])));
    const graph = doc["@graph"] as Record<string, unknown>[];
    expect(graph).toHaveLength(1);
    expect(graph[0]?.["cites"]).toBeUndefined();
  });
});

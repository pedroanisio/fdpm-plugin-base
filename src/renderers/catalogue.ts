// ---------------------------------------------------------------------------
// catalogue -- the FRBR-layered Markdown view of a media workbook.
//
// The host's profile-generic renderer groups records by type and prints one
// table per group. That is the correct thing to do knowing no domain, and it
// is exactly what this profile is not: a media catalogue's meaning is the
// spine -- which work a recording realizes, which release carries a track,
// which registry names which layer -- and a table per type shows every one of
// those as an opaque id in a cell.
//
// This renderer walks the spine instead, reading it off the profile's own
// reference annotations (see `model.ts`), and reports every reference that
// does not resolve rather than printing a broken link as if it were fine.
// ---------------------------------------------------------------------------

import type { DomainProfile, PrimitiveInstance, RelationInstance } from "@fdpm/cli";
import type { RenderFinding, RendererFn, RendererOutput } from "../host-contract.js";
import { predicateOfRelationType } from "../validators.js";
import { LAYERS, PROFILE_ID, schemeByName, type Layer } from "../vocabulary.js";
import {
  RENDER_TARGET,
  block,
  bytesOf,
  escapeInline,
  finding,
  localized,
  num,
  plural,
  refuse,
  str,
  table,
  titleOf,
} from "./markdown.js";
import { indexWorkbook, layerOfType, typeName, type WorkbookIndex } from "./model.js";

/** Renderer id the manifest declares and the profile binds. */
export const CATALOGUE_RENDERER_ID = "media:CatalogueRenderer";

/** Path the host suggests when writing this document to disk. */
export const CATALOGUE_OUTPUT_PATH = "catalogue.md";

/** Layer, capitalized for a heading. */
function layerLabel(layer: Layer): string {
  return `${layer.charAt(0).toUpperCase()}${layer.slice(1)}`;
}

/**
 * Every enum-valued field the record sets, as `name=value`.
 *
 * @remarks
 * The discriminating facts of a media record are the enums the profile chose
 * to close -- release type, cut kind, platform, agent kind, motivation. Which
 * ones a type carries is read from the profile rather than listed here, so a
 * new closed vocabulary appears in the document the day it is declared.
 */
function enumFacts(profile: DomainProfile, primitive: PrimitiveInstance): string[] {
  const type = profile.primitive_types.find((t) => t.id === primitive.type_id);
  if (type === undefined) return [];
  const out: string[] = [];
  for (const field of type.fields) {
    // `layer` is pinned and already shown; showing it twice says nothing.
    if (field.kind !== "enum" || field.name === "layer") continue;
    const value = str(primitive.field_values, field.name);
    if (value === undefined) continue;
    out.push(`${escapeInline(field.name)}=${escapeInline(value)}`);
  }
  return out;
}

/**
 * Render one identifier as its registry, its value and its own record id.
 *
 * @remarks
 * A scheme outside {@link schemeByName}'s table is `other`, whose registry
 * name the record supplies itself; naming the raw token is more honest than
 * inventing a label for it.
 */
function identifierLine(primitive: PrimitiveInstance): string {
  const scheme = str(primitive.field_values, "scheme") ?? "unknown";
  const label = schemeByName(scheme)?.label ?? str(primitive.field_values, "schemeName") ?? scheme;
  const value = str(primitive.field_values, "value") ?? "";
  return `${escapeInline(label)} \`${escapeInline(value)}\` (\`${escapeInline(primitive.id)}\`)`;
}

/** Identifiers naming a record, rendered with the registry they belong to. */
function identifierLines(index: WorkbookIndex, recordId: string): string[] {
  const out: string[] = [];
  for (const primitive of index.byId.values()) {
    if (primitive.type_id !== "media:Identifier") continue;
    if (str(primitive.field_values, "identifiesId") !== recordId) continue;
    out.push(identifierLine(primitive));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Credits on a record, read from the `attributedTo` edges leaving it. */
function creditLines(index: WorkbookIndex, recordId: string): string[] {
  const out: string[] = [];
  for (const edge of index.edgesFrom.get(recordId) ?? []) {
    if (predicateOfRelationType(edge.type_id) !== "attributedTo") continue;
    const role = str(edge.field_values, "role") ?? "contributor";
    const agent = index.byId.get(edge.target_id);
    const name = agent === undefined ? edge.target_id : titleOf(agent);
    out.push(`${escapeInline(role)} ${escapeInline(name)} (\`${escapeInline(edge.target_id)}\`)`);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** The one-line description under a record's heading. */
function metaLine(profile: DomainProfile, primitive: PrimitiveInstance): string {
  const parts = [`*${escapeInline(typeName(profile, primitive.type_id))}*`];
  const layer = layerOfType(profile, primitive.type_id);
  if (layer !== undefined) parts.push(layer);
  parts.push(...enumFacts(profile, primitive));

  const languages = primitive.field_values["languages"];
  if (Array.isArray(languages) && languages.length > 0) {
    parts.push(
      languages
        .filter((l) => typeof l === "string")
        .map(escapeInline)
        .join(", "),
    );
  }
  const duration = num(primitive.field_values, "duration");
  if (duration !== undefined) parts.push(`${duration}s`);
  return parts.join(" · ");
}

/** One bullet in the containment tree, at the given depth. */
function childLine(profile: DomainProfile, primitive: PrimitiveInstance, depth: number): string {
  const indent = "  ".repeat(depth);
  return (
    `${indent}- **${escapeInline(titleOf(primitive))}** — ` +
    `\`${escapeInline(primitive.id)}\` · ${metaLine(profile, primitive)}`
  );
}

/**
 * Walk one root's containment subtree, depth-first and id-ordered.
 *
 * @remarks
 * Termination is structural rather than capped. `indexWorkbook` gives every
 * record at most one composition parent and cuts any link that closes a cycle,
 * so `childrenOf` is a forest and the walk visits each record once. A depth
 * limit here would add nothing to that and would silently drop records from a
 * chain that is merely long, which is the one thing this document must never
 * do -- an unrendered record is invisible, while a reported one is not.
 *
 * @param profile - Profile governing the workbook.
 * @param index - The indexed workbook.
 * @param rootId - Record whose descendants are walked.
 * @returns The subtree's lines; empty when the record owns nothing.
 */
function subtree(profile: DomainProfile, index: WorkbookIndex, rootId: string): string[] {
  const lines: string[] = [];

  const walk = (parentId: string, depth: number): void => {
    for (const childId of index.childrenOf.get(parentId) ?? []) {
      const child = index.byId.get(childId);
      /* c8 ignore next -- childrenOf only ever holds ids indexWorkbook resolved */
      if (child === undefined) continue;
      lines.push(childLine(profile, child, depth));
      lines.push(...attributeLines(index, child, "  ".repeat(depth + 1)));
      walk(childId, depth + 1);
    }
  };

  walk(rootId, 1);
  return lines;
}

/** Identifier and credit lines for a record, at a given indent. */
function attributeLines(
  index: WorkbookIndex,
  primitive: PrimitiveInstance,
  indent: string,
): string[] {
  const out: string[] = [];
  const identifiers = identifierLines(index, primitive.id);
  if (identifiers.length > 0) out.push(`${indent}- Identifiers — ${identifiers.join(", ")}`);
  const credits = creditLines(index, primitive.id);
  if (credits.length > 0) out.push(`${indent}- Credits — ${credits.join(", ")}`);
  return out;
}

/** One root record and everything it owns. */
function rootBlock(
  profile: DomainProfile,
  index: WorkbookIndex,
  primitive: PrimitiveInstance,
  findings: RenderFinding[],
): string[] {
  const heading = `#### ${escapeInline(titleOf(primitive))} — \`${escapeInline(primitive.id)}\``;
  const meta = [metaLine(profile, primitive)];

  const resolution = localized(primitive.field_values["title"]);
  if (resolution !== undefined && !resolution.primaryResolved) {
    findings.push(
      finding(
        CATALOGUE_RENDERER_ID,
        `${primitive.id}.title.primaryLocale`,
        `no entry for the declared primary locale; rendered the ${resolution.locale} entry`,
      ),
    );
  }

  const identifiers = identifierLines(index, primitive.id);
  if (identifiers.length > 0) meta.push(`**Identifiers** — ${identifiers.join(", ")}`);
  const credits = creditLines(index, primitive.id);
  if (credits.length > 0) meta.push(`**Credits** — ${credits.join(", ")}`);

  const lines = [heading, "", ...block(meta)];

  const summary = localized(primitive.field_values["summary"]);
  if (summary !== undefined) lines.push("", escapeInline(summary.text));

  const tree = subtree(profile, index, primitive.id);
  if (tree.length > 0) lines.push("", ...tree);
  lines.push("");
  return lines;
}

/** The `## Contents` inventory: how many records of each type, by layer. */
function contentsSection(profile: DomainProfile, index: WorkbookIndex): string[] {
  const counts = new Map<string, number>();
  for (const primitive of index.byId.values()) {
    counts.set(primitive.type_id, (counts.get(primitive.type_id) ?? 0) + 1);
  }
  const layerRank = (typeId: string): number => {
    const layer = layerOfType(profile, typeId);
    return layer === undefined ? LAYERS.length : LAYERS.indexOf(layer);
  };
  const rows = [...counts.entries()]
    .sort(
      (a, b) =>
        layerRank(a[0]) - layerRank(b[0]) ||
        typeName(profile, a[0]).localeCompare(typeName(profile, b[0])),
    )
    .map(([typeId, count]) => {
      const layer = layerOfType(profile, typeId);
      return [
        layer === undefined ? "—" : layerLabel(layer),
        escapeInline(typeName(profile, typeId)),
        String(count),
      ];
    });
  return ["## Contents", "", ...table(["Layer", "Type", "Records"], rows), ""];
}

/** The forest, grouped by the layer each root sits at. */
function catalogueSection(
  profile: DomainProfile,
  index: WorkbookIndex,
  findings: RenderFinding[],
): string[] {
  // Membership is the pinned `layer` enum, not a list kept here: a type the
  // profile gains sits in the forest if it declares a layer and in its own
  // table if it does not, and neither case needs an edit in this file.
  const resourceRoots = index.rootIds
    .map((id) => index.byId.get(id))
    .filter(
      (p): p is PrimitiveInstance =>
        p !== undefined && layerOfType(profile, p.type_id) !== undefined,
    );
  if (resourceRoots.length === 0) return [];

  const lines = ["## Catalogue", ""];
  for (const layer of LAYERS) {
    const roots = resourceRoots.filter((p) => layerOfType(profile, p.type_id) === layer);
    if (roots.length === 0) continue;
    lines.push(`### ${layerLabel(layer)}`, "");
    for (const root of roots) lines.push(...rootBlock(profile, index, root, findings));
  }
  return lines;
}

/**
 * One table per type that sits outside the FRBR layering.
 *
 * @remarks
 * Every record the workbook holds is reachable from the document: a record
 * with a layer is in the forest, and one without is here. Identifiers are the
 * single exception, because they are rendered against the record they name --
 * so the ones whose `identifiesId` resolves are omitted here and the ones
 * whose reference dangles are not, which keeps the guarantee whole.
 */
function supportingSection(profile: DomainProfile, index: WorkbookIndex): string[] {
  const present = new Set(
    [...index.byId.values()]
      .map((p) => p.type_id)
      .filter((typeId) => layerOfType(profile, typeId) === undefined),
  );
  const categoryOf = (typeId: string): string =>
    profile.primitive_types.find((t) => t.id === typeId)?.category_id ?? "";

  // Grouped under the profile's own category names, in the order the profile
  // declares them, so the document's sections are the model's sections.
  const typeIds = [...present].sort(
    (a, b) =>
      profile.categories.findIndex((c) => c.id === categoryOf(a)) -
        profile.categories.findIndex((c) => c.id === categoryOf(b)) ||
      typeName(profile, a).localeCompare(typeName(profile, b)),
  );

  // A category holding one type would otherwise print its name twice, once as
  // the section and once as the only table under it.
  const typesInCategory = new Map<string, number>();
  for (const typeId of typeIds) {
    const category = categoryOf(typeId);
    typesInCategory.set(category, (typesInCategory.get(category) ?? 0) + 1);
  }

  const lines: string[] = [];
  let openCategory: string | undefined;
  for (const typeId of typeIds) {
    let records = [...index.byId.values()].filter((p) => p.type_id === typeId);
    if (typeId === "media:Identifier") {
      records = records.filter((p) => {
        const names = str(p.field_values, "identifiesId");
        return names === undefined || !index.byId.has(names);
      });
    }
    if (records.length === 0) continue;

    const category = categoryOf(typeId);
    if (category !== openCategory) {
      const name = profile.categories.find((c) => c.id === category)?.name ?? category;
      lines.push(`## ${escapeInline(name)}`, "");
      openCategory = category;
    }
    if ((typesInCategory.get(category) ?? 0) > 1) {
      lines.push(`### ${escapeInline(typeName(profile, typeId))}`, "");
    }
    if (typeId === "media:Identifier") {
      lines.push(
        "Identifiers naming a record this workbook does not contain. The rest are " +
          "shown against the records they name.",
        "",
      );
    }
    if (typeId === "media:Annotation") {
      lines.push(
        "Listed for completeness. Their anchors are rendered by " +
          "`media:AnnotationIndexRenderer`.",
        "",
      );
    }
    const rows = records.map((p) => [
      escapeInline(titleOf(p)),
      `\`${escapeInline(p.id)}\``,
      escapeInline(enumFacts(profile, p).join(" · ")) || "—",
    ]);
    lines.push(...table(["Record", "Id", "Facts"], rows), "");
  }
  return lines;
}

/** Every association edge, grouped by the predicate it asserts. */
function edgeSection(index: WorkbookIndex, relations: readonly RelationInstance[]): string[] {
  if (relations.length === 0) return [];
  const named = (id: string): string => {
    const record = index.byId.get(id);
    return record === undefined
      ? `\`${escapeInline(id)}\``
      : `${escapeInline(titleOf(record))} (\`${escapeInline(id)}\`)`;
  };
  const rows = [...relations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((edge) => {
      const predicate =
        str(edge.field_values, "predicate") ?? predicateOfRelationType(edge.type_id);
      const confidence = num(edge.field_values, "confidence");
      const kind = str(edge.field_values, "assertionKind") ?? "—";
      return [
        named(edge.source_id),
        escapeInline(predicate ?? edge.type_id),
        named(edge.target_id),
        confidence === undefined ? kind : `${kind} (${confidence})`,
      ];
    });
  return [
    "## Association edges",
    "",
    ...table(["Subject", "Predicate", "Object", "Assertion"], rows),
    "",
  ];
}

/** Findings, restated in the document so a reader of the file sees them too. */
function integritySection(findings: readonly RenderFinding[]): string[] {
  if (findings.length === 0) return [];
  return [
    "## Integrity",
    "",
    `${plural(findings.length, "reference")} did not resolve.`,
    "",
    ...findings.map((f) => `- \`${escapeInline(f.expression)}\` — ${escapeInline(f.message)}`),
    "",
  ];
}

/**
 * Render a media workbook as an FRBR-layered Markdown catalogue.
 *
 * @param input - Workbook slice supplied by the host.
 * @returns The document, its content type, and every reference that failed to
 * resolve.
 */
export const renderCatalogue: RendererFn = (input): RendererOutput => {
  if (input.profile.id !== PROFILE_ID) {
    return refuse({
      rendererId: CATALOGUE_RENDERER_ID,
      filename: CATALOGUE_OUTPUT_PATH,
      governs: PROFILE_ID,
      found: input.profile.id,
    });
  }

  const findings: RenderFinding[] = [];
  const index = indexWorkbook(input.profile, input.primitives, input.relations);

  for (const reference of index.dangling) {
    findings.push(
      finding(
        CATALOGUE_RENDERER_ID,
        `${reference.fromId}.${reference.field}`,
        `${reference.relationship} reference names ${reference.toId}, ` +
          "which this workbook does not contain",
      ),
    );
  }

  for (const id of index.cycleBroken) {
    findings.push(
      finding(
        CATALOGUE_RENDERER_ID,
        `${id}.parent`,
        "composition reference closes a cycle; the link was cut so the records " +
          "in it are still rendered, but their containment is not what the " +
          "workbook declares",
      ),
    );
  }

  const name = input.workbook?.name ?? input.workbookId;
  const lines = [
    `# Media catalogue — ${escapeInline(name)}`,
    "",
    `\`${PROFILE_ID}\` · ${input.primitives.length} records · ${input.relations.length} edges`,
    "",
  ];

  if (input.primitives.length === 0) {
    lines.push("No records. This workbook is empty.", "");
  } else {
    lines.push(...contentsSection(input.profile, index));
    lines.push(...catalogueSection(input.profile, index, findings));
    lines.push(...supportingSection(input.profile, index));
    lines.push(...edgeSection(index, input.relations));
  }
  lines.push(...integritySection(findings));

  if (input.renderedAt !== undefined) {
    lines.push("---", "", `Rendered ${escapeInline(input.renderedAt)}.`);
  }

  return {
    bytes: bytesOf(lines),
    contentType: RENDER_TARGET,
    filename: CATALOGUE_OUTPUT_PATH,
    findings,
  };
};

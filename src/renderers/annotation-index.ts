// ---------------------------------------------------------------------------
// annotation-index -- annotations, grouped by what they are attached to.
//
// `media:Annotation` carries twenty-odd anchor fields of which `selectorType`
// makes at most four meaningful at a time. The meta-model cannot express a
// conditionally required field, so a generic table renders every annotation as
// a row that is mostly empty and says nothing about where it actually points.
//
// This renderer reads the selector and prints only the anchor it discriminates
// -- a time range, a page, a character span with the normalization form the
// offsets were counted under -- and reports the annotations whose selector
// promises an anchor the record does not carry, which is the one defect no
// write-time rule in this profile can catch.
// ---------------------------------------------------------------------------

import type { PrimitiveInstance } from "@fdpm/cli";
import type { RenderFinding, RendererFn, RendererOutput } from "../host-contract.js";
import { predicateOfRelationType } from "../validators.js";
import { PROFILE_ID } from "../vocabulary.js";
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
  titleOf,
} from "./markdown.js";
import { indexWorkbook, typeName, type WorkbookIndex } from "./model.js";

/** Renderer id the manifest declares and the profile binds. */
export const ANNOTATION_RENDERER_ID = "media:AnnotationIndexRenderer";

/** Path the host suggests when writing this document to disk. */
export const ANNOTATION_OUTPUT_PATH = "annotations.md";

/** The anchor a selector kind promises, and how it reads once resolved. */
interface AnchorSpec {
  /** Fields the selector makes meaningful. All must be present. */
  requires: readonly string[];
  /** Render the anchor from a record known to carry every required field. */
  format: (values: Record<string, unknown>) => string;
}

/** Number as written, without a trailing `.0` a float would otherwise gain. */
function n(values: Record<string, unknown>, name: string): string {
  return String(num(values, name));
}

/**
 * What each `selectorType` addresses.
 *
 * @remarks
 * Keyed by the profile's own `selectorType` enum. A kind absent from this
 * table is one the profile added without teaching this renderer to read it;
 * that case reports a finding rather than printing a blank anchor.
 */
const ANCHORS: Readonly<Record<string, AnchorSpec>> = {
  whole: { requires: [], format: () => "whole resource" },
  structural: { requires: [], format: () => "structural selector" },
  textQuote: {
    requires: ["exactQuote"],
    format: (v) => {
      const prefix = str(v, "prefixQuote");
      const suffix = str(v, "suffixQuote");
      const quote = `“${escapeInline(str(v, "exactQuote") ?? "")}”`;
      // The context is what re-anchors the quote after the target changes, so
      // it is part of the anchor rather than decoration around it.
      return [
        prefix === undefined ? undefined : `…${escapeInline(prefix)}`,
        quote,
        suffix === undefined ? undefined : `${escapeInline(suffix)}…`,
      ]
        .filter((part) => part !== undefined)
        .join(" ");
    },
  },
  textPosition: {
    // Offsets without their normalization form are not a position: the same
    // pair addresses different text under NFC and NFD.
    requires: ["startOffset", "endOffset", "unicodeNormalization"],
    format: (v) =>
      `characters ${n(v, "startOffset")}–${n(v, "endOffset")} ` +
      `(${escapeInline(str(v, "unicodeNormalization") ?? "")})`,
  },
  timeRange: {
    requires: ["startTime", "endTime"],
    format: (v) => {
      const smpteStart = str(v, "smpteStart");
      const smpteEnd = str(v, "smpteEnd");
      const range = `${n(v, "startTime")}s–${n(v, "endTime")}s`;
      return smpteStart !== undefined && smpteEnd !== undefined
        ? `${range} (${escapeInline(smpteStart)}–${escapeInline(smpteEnd)})`
        : range;
    },
  },
  spatialRegion: {
    requires: ["regionX", "regionY", "regionWidth", "regionHeight"],
    format: (v) =>
      `xywh=percent:${n(v, "regionX")},${n(v, "regionY")},` +
      `${n(v, "regionWidth")},${n(v, "regionHeight")}`,
  },
  svg: {
    requires: ["svgPath"],
    format: (v) => `SVG path (${(str(v, "svgPath") ?? "").length} characters)`,
  },
  page: { requires: ["pageNumber"], format: (v) => `page ${n(v, "pageNumber")}` },
  epubCfi: {
    requires: ["cfiRange"],
    format: (v) => `EPUB CFI \`${escapeInline(str(v, "cfiRange") ?? "")}\``,
  },
  css: {
    requires: ["cssSelector"],
    format: (v) => `CSS \`${escapeInline(str(v, "cssSelector") ?? "")}\``,
  },
};

/** Whether a field carries a value the anchor can be built from. */
function present(values: Record<string, unknown>, name: string): boolean {
  return str(values, name) !== undefined || num(values, name) !== undefined;
}

/** The rendered anchor, or the fields that stopped it being rendered. */
interface ResolvedAnchor {
  text: string;
  missing: readonly string[];
  unknownSelector: boolean;
}

/**
 * Resolve one annotation's anchor from the selector it declares.
 *
 * @param annotation - The annotation record.
 * @returns The anchor text, and the required fields the record does not set.
 */
export function anchorOf(annotation: PrimitiveInstance): ResolvedAnchor {
  const values = annotation.field_values;
  const selector = str(values, "selectorType");
  if (selector === undefined) {
    return { text: "no selector declared", missing: ["selectorType"], unknownSelector: false };
  }
  const spec = ANCHORS[selector];
  if (spec === undefined) {
    return { text: `\`${escapeInline(selector)}\``, missing: [], unknownSelector: true };
  }
  const missing = spec.requires.filter((field) => !present(values, field));
  if (missing.length > 0) {
    return { text: `\`${escapeInline(selector)}\`, unanchored`, missing, unknownSelector: false };
  }
  return { text: spec.format(values), missing: [], unknownSelector: false };
}

/** Ids the annotation's outgoing edges point at, sorted and de-duplicated. */
function targetsOf(index: WorkbookIndex, annotationId: string): string[] {
  const ids = new Set<string>();
  for (const edge of index.edgesFrom.get(annotationId) ?? []) ids.add(edge.target_id);
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** The predicate each edge from the annotation asserts, for the anchor line. */
function predicatesTo(index: WorkbookIndex, annotationId: string, targetId: string): string[] {
  const out = new Set<string>();
  for (const edge of index.edgesFrom.get(annotationId) ?? []) {
    if (edge.target_id !== targetId) continue;
    out.add(
      str(edge.field_values, "predicate") ?? predicateOfRelationType(edge.type_id) ?? edge.type_id,
    );
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** One annotation, rendered under whatever it is attached to. */
function annotationBlock(
  annotation: PrimitiveInstance,
  via: readonly string[],
  findings: RenderFinding[],
): string[] {
  const values = annotation.field_values;
  const anchor = anchorOf(annotation);

  if (anchor.missing.length > 0) {
    findings.push(
      finding(
        ANNOTATION_RENDERER_ID,
        `${annotation.id}.anchor`,
        `selectorType ${str(values, "selectorType") ?? "(unset)"} requires ` +
          `${anchor.missing.join(", ")}; the record sets none of them`,
      ),
    );
  }
  if (anchor.unknownSelector) {
    findings.push(
      finding(
        ANNOTATION_RENDERER_ID,
        `${annotation.id}.selectorType`,
        `selector ${str(values, "selectorType")} has no anchor form in this renderer`,
      ),
    );
  }

  const motivation = str(values, "motivation") ?? "—";
  const bodyType = str(values, "bodyType") ?? "—";
  const facts = [`**Anchor** — ${anchor.text}`];

  const status = str(values, "anchorStatus");
  if (status !== undefined) facts.push(`**Status** — ${escapeInline(status)}`);

  const kind = str(values, "assertionKind") ?? "—";
  const confidence = num(values, "confidence");
  const assertedBy = str(values, "assertedBy") ?? "—";
  const assertedAt = str(values, "assertedAt") ?? "—";
  facts.push(
    `**Assertion** — ${escapeInline(kind)}` +
      (confidence === undefined ? "" : ` (confidence ${confidence})`) +
      `, by ${escapeInline(assertedBy)} at ${escapeInline(assertedAt)}`,
  );

  if (via.length > 0) facts.push(`**Attached via** — ${via.map(escapeInline).join(", ")}`);

  const lines = [
    `### \`${escapeInline(annotation.id)}\` — ${escapeInline(motivation)} / ${escapeInline(bodyType)}`,
    "",
    ...block(facts),
  ];

  const body = localized(values["bodyValue"]);
  if (body !== undefined) lines.push("", `> ${escapeInline(body.text)}`);
  lines.push("");
  return lines;
}

/**
 * Render every annotation in a media workbook, grouped by its target.
 *
 * @param input - Workbook slice supplied by the host.
 * @returns The document, its content type, and every anchor that did not
 * resolve.
 */
export const renderAnnotationIndex: RendererFn = (input): RendererOutput => {
  if (input.profile.id !== PROFILE_ID) {
    return refuse({
      rendererId: ANNOTATION_RENDERER_ID,
      filename: ANNOTATION_OUTPUT_PATH,
      governs: PROFILE_ID,
      found: input.profile.id,
    });
  }

  const findings: RenderFinding[] = [];
  const index = indexWorkbook(input.profile, input.primitives, input.relations);
  const annotations = [...index.byId.values()].filter((p) => p.type_id === "media:Annotation");

  const byTarget = new Map<string, PrimitiveInstance[]>();
  const unattached: PrimitiveInstance[] = [];
  for (const annotation of annotations) {
    const targets = targetsOf(index, annotation.id);
    if (targets.length === 0) {
      unattached.push(annotation);
      continue;
    }
    for (const targetId of targets) {
      const bucket = byTarget.get(targetId);
      if (bucket === undefined) byTarget.set(targetId, [annotation]);
      else bucket.push(annotation);
    }
  }

  const name = input.workbook?.name ?? input.workbookId;
  const lines = [
    `# Annotations — ${escapeInline(name)}`,
    "",
    `\`${PROFILE_ID}\` · ${plural(annotations.length, "annotation")} on ` +
      `${plural(byTarget.size, "resource")}`,
    "",
  ];

  if (annotations.length === 0) {
    lines.push("No annotations. Nothing in this workbook is annotated.", "");
  }

  for (const targetId of [...byTarget.keys()].sort((a, b) => a.localeCompare(b))) {
    const target = index.byId.get(targetId);
    const heading =
      target === undefined
        ? `\`${escapeInline(targetId)}\``
        : `${escapeInline(titleOf(target))} — \`${escapeInline(targetId)}\``;
    lines.push(`## ${heading}`, "");
    if (target !== undefined) {
      lines.push(`*${escapeInline(typeName(input.profile, target.type_id))}*`, "");
    }
    for (const annotation of byTarget.get(targetId) ?? []) {
      lines.push(
        ...annotationBlock(annotation, predicatesTo(index, annotation.id, targetId), findings),
      );
    }
  }

  if (unattached.length > 0) {
    lines.push("## Attached to nothing", "");
    lines.push(
      "An annotation states something about a target. These carry no edge to one, " +
        "so what they describe cannot be recovered from the workbook.",
      "",
    );
    for (const annotation of unattached) {
      findings.push(
        finding(
          ANNOTATION_RENDERER_ID,
          `${annotation.id}.target`,
          "annotation has no target edge; nothing records what it annotates",
        ),
      );
      lines.push(...annotationBlock(annotation, [], findings));
    }
  }

  if (findings.length > 0) {
    lines.push(
      "## Integrity",
      "",
      `${plural(findings.length, "anchor")} did not resolve.`,
      "",
      ...findings.map((f) => `- \`${escapeInline(f.expression)}\` — ${escapeInline(f.message)}`),
      "",
    );
  }

  if (input.renderedAt !== undefined) {
    lines.push("---", "", `Rendered ${escapeInline(input.renderedAt)}.`);
  }

  return {
    bytes: bytesOf(lines),
    contentType: RENDER_TARGET,
    filename: ANNOTATION_OUTPUT_PATH,
    findings,
  };
};

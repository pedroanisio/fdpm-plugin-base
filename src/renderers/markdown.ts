// ---------------------------------------------------------------------------
// markdown -- text primitives shared by every renderer this plugin ships.
//
// Two concerns live here because both are places a renderer silently produces
// a wrong document rather than failing: escaping, where an unescaped title
// closes a table row early and shifts every column after it, and localized
// text, where picking the wrong entry of a locale map is invisible to anyone
// who does not read that locale.
// ---------------------------------------------------------------------------

import type { PrimitiveInstance } from "@fdpm/cli";
import type { RenderFinding, RendererOutput } from "../host-contract.js";

/**
 * Characters that change how Markdown parses a line when they appear inside
 * a heading, a list item or a table cell. `|` is included because every table
 * in these documents would otherwise gain a column from a title containing
 * one; `<` because a value that looks like a tag start is swallowed by an
 * HTML-tolerant renderer.
 */
const INLINE_SPECIAL = /([\\`*_[\]<|])/g;

/**
 * Make a value inert wherever it is interpolated into Markdown.
 *
 * @param value - Raw text, typically read from a record's field values.
 * @returns The text with inline syntax escaped and line breaks flattened.
 */
export function escapeInline(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(INLINE_SPECIAL, "\\$1");
}

/** One locale's entry, chosen from a localized value. */
export interface LocalizedResolution {
  /** The chosen text. */
  text: string;
  /** Locale of the chosen entry. */
  locale: string;
  /** False when the declared primary locale had no entry and a fallback was used. */
  primaryResolved: boolean;
}

/**
 * Choose the entry a reader should see from a stored localized value.
 *
 * @remarks
 * `media:val:localized-text-primary-locale` rejects a value whose primary
 * locale has no entry, so `primaryResolved: false` means the record predates
 * that rule. The fallback renders the first entry rather than nothing --
 * an empty heading is a worse artifact than one in an unexpected locale --
 * and the flag lets the caller say which happened.
 *
 * @param raw - A stored field value, of any shape.
 * @returns The chosen entry, or `undefined` when `raw` is not localized text.
 */
export function localized(raw: unknown): LocalizedResolution | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as Record<string, unknown>;
  const primaryLocale = candidate["primaryLocale"];
  const values = candidate["values"];
  if (typeof primaryLocale !== "string" || !Array.isArray(values) || values.length === 0) {
    return undefined;
  }

  const entries: { locale: string; text: string }[] = [];
  for (const entry of values) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row["locale"] !== "string" || typeof row["text"] !== "string") continue;
    entries.push({ locale: row["locale"], text: row["text"] });
  }
  if (entries.length === 0) return undefined;

  const primary = entries.find((e) => e.locale === primaryLocale);
  if (primary !== undefined) {
    return { text: primary.text, locale: primary.locale, primaryResolved: true };
  }
  const fallback = entries[0]!;
  return { text: fallback.text, locale: fallback.locale, primaryResolved: false };
}

/**
 * Field names that carry a record's display title, in the order they are tried.
 *
 * `bodyValue` is last because it names only annotations, whose human-facing
 * text is what they say rather than a title they carry.
 */
const LOCALIZED_TITLE_FIELDS = ["title", "label", "bodyValue"] as const;
const PLAIN_TITLE_FIELDS = ["name"] as const;

/**
 * The best one-line name for a record.
 *
 * @param primitive - The record to name.
 * @returns Its title, label or name; its id when it carries none.
 */
export function titleOf(primitive: PrimitiveInstance): string {
  for (const field of LOCALIZED_TITLE_FIELDS) {
    const resolved = localized(primitive.field_values[field]);
    if (resolved !== undefined && resolved.text.trim() !== "") return resolved.text;
  }
  for (const field of PLAIN_TITLE_FIELDS) {
    const raw = primitive.field_values[field];
    if (typeof raw === "string" && raw.trim() !== "") return raw;
  }
  return primitive.id;
}

/** Read a field as a trimmed non-empty string, or `undefined`. */
export function str(values: Record<string, unknown>, name: string): string | undefined {
  const raw = values[name];
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  return raw;
}

/** Read a field as a finite number, or `undefined`. */
export function num(values: Record<string, unknown>, name: string): number | undefined {
  const raw = values[name];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Render consecutive lines as one block rather than one run-on paragraph.
 *
 * @remarks
 * Markdown joins adjacent lines into a single paragraph unless each is ended
 * with a hard line break. Without this, a record's type line, its identifiers
 * and its credits render as one long sentence with the labels buried in it.
 *
 * @param lines - Lines belonging to one block.
 * @returns The same lines, each but the last ending in a hard line break.
 */
export function block(lines: readonly string[]): string[] {
  return lines.map((line, i) => (i === lines.length - 1 ? line : `${line}  `));
}

/**
 * Count and noun, agreeing in number.
 *
 * @param count - How many.
 * @param singular - The noun in its singular form.
 * @returns `1 annotation`, `2 annotations`.
 */
export function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Assemble a GitHub-flavoured Markdown table.
 *
 * @param headers - Column headings, already escaped.
 * @param rows - Cell values, already escaped, one array per row.
 * @returns The table's lines, or an empty array when there are no rows.
 */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  if (rows.length === 0) return [];
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
}

/** MIME type every Markdown renderer in this directory registers under. */
export const RENDER_TARGET = "text/markdown" as const;

/**
 * Build one render finding.
 *
 * @remarks
 * `templateId` carries the renderer id and `line`/`column` are zero because
 * these renderers use no template; the host's finding shape was defined for
 * the template DSL and is the only findings channel a renderer has.
 *
 * @param rendererId - Renderer reporting the problem.
 * @param expression - Field or record that could not be resolved.
 * @param message - What went wrong, in the operator's terms.
 * @returns The finding, ready to attach to a {@link RendererOutput}.
 */
export function finding(rendererId: string, expression: string, message: string): RenderFinding {
  return { kind: "render-error", templateId: rendererId, line: 0, column: 0, expression, message };
}

/** UTF-8 bytes of a document assembled from lines. */
export function bytesOf(lines: readonly string[]): Uint8Array {
  return new TextEncoder().encode(
    `${lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd()}\n`,
  );
}

/**
 * Refuse to render a workbook this profile does not govern.
 *
 * @remarks
 * Refusal is in-band rather than a throw. The host treats any exception that
 * is not its own `FDPMException` as a plugin defect and quarantines the plugin
 * that raised it, and `FDPMException` is only reachable through a runtime
 * import of `@fdpm/cli` -- which a deployed plugin directory, copied without
 * `node_modules`, cannot resolve. So a caller who points this renderer at
 * another profile's workbook gets a document saying exactly that, plus a
 * finding that fails `fdpm render --strict`, and the plugin stays active.
 *
 * @param args - Renderer identity and the two profile ids involved.
 * @returns A complete refusal document.
 */
export function refuse(args: {
  rendererId: string;
  filename: string;
  governs: string;
  found: string;
}): RendererOutput {
  const lines = [
    "# Not rendered",
    "",
    `\`${args.rendererId}\` renders \`${args.governs}\` workbooks. ` +
      `This workbook declares \`${args.found}\`.`,
    "",
    "No records were read. Render this workbook through a renderer its own " +
      "profile declares, or through the host's profile-generic " +
      "`core:WorkbookRenderer`.",
  ];
  return {
    bytes: bytesOf(lines),
    contentType: RENDER_TARGET,
    filename: args.filename,
    findings: [
      finding(
        args.rendererId,
        "workbook.profile_id",
        `expected ${args.governs}, got ${args.found}`,
      ),
    ],
  };
}

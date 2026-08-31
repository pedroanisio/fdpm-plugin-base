// ---------------------------------------------------------------------------
// renderers -- the one list the manifest, the profile and `activate` all read.
//
// A renderer has to be stated in three places: as a `cap:renderer` row in
// `fdpm-plugin.json`, which is what the host registers from; as a binding on
// the profile, which is what `findRenderer` disambiguates with when several
// plugins claim `text/markdown`; and as a `registerRenderer` call. Keeping
// three hand-written lists in step is the failure this file exists to remove
// -- the profile bindings and the registrations are both generated from the
// table below, and `tests/renderers.test.ts` asserts the manifest matches it.
// ---------------------------------------------------------------------------

import type { RendererBinding } from "@fdpm/cli";
import type { RendererFn } from "../host-contract.js";
import { RENDER_TARGET } from "./markdown.js";
import {
  ANNOTATION_OUTPUT_PATH,
  ANNOTATION_RENDERER_ID,
  renderAnnotationIndex,
} from "./annotation-index.js";
import { CATALOGUE_OUTPUT_PATH, CATALOGUE_RENDERER_ID, renderCatalogue } from "./catalogue.js";

export { RENDER_TARGET } from "./markdown.js";
export { CATALOGUE_RENDERER_ID } from "./catalogue.js";
export { ANNOTATION_RENDERER_ID } from "./annotation-index.js";

/** One renderer, in every form the three declaration sites need it. */
export interface MediaRenderer {
  /** Id the host registers it under and a caller selects it by. */
  rendererId: string;
  /** Manifest `local_name`; the host constrains it to `^[a-z0-9-]+$`. */
  localName: string;
  /** MIME type the host dispatches on, and the content type of the output. */
  target: string;
  /** Path the host suggests when writing the document to disk. */
  outputPath: string;
  /** What the renderer produces, for the manifest and the profile binding. */
  description: string;
  /** The renderer itself. */
  fn: RendererFn;
}

/**
 * Every renderer this plugin contributes.
 *
 * @remarks
 * Order is load-bearing. `PluginRuntime.findRenderer` resolves a target with
 * no explicit `--renderer-id` by taking the first renderer the profile
 * declares, so the entry listed first is what `fdpm render <workbook>
 * text/markdown` returns.
 */
export const RENDERERS: readonly MediaRenderer[] = [
  {
    rendererId: CATALOGUE_RENDERER_ID,
    localName: "catalogue-md",
    target: RENDER_TARGET,
    outputPath: CATALOGUE_OUTPUT_PATH,
    description:
      "FRBR-layered catalogue: each work with the expressions, manifestations and assets it owns, identifiers resolved against their registries, credits from attributedTo edges, and every reference that does not resolve reported as a finding.",
    fn: renderCatalogue,
  },
  {
    rendererId: ANNOTATION_RENDERER_ID,
    localName: "annotations-md",
    target: RENDER_TARGET,
    outputPath: ANNOTATION_OUTPUT_PATH,
    description:
      "Annotations grouped by the resource they are attached to, each shown with the anchor its selectorType discriminates -- time range, character span, page, region -- and a finding where the selector promises an anchor the record does not carry.",
    fn: renderAnnotationIndex,
  },
];

/**
 * The renderer bindings the profile declares.
 *
 * @remarks
 * The `renderer_id` form, which is what a `cap:renderer` renderer uses; the
 * CLI's own native form binds a template to a primitive type and does not
 * apply here.
 */
export const RENDERER_BINDINGS: readonly RendererBinding[] = RENDERERS.map((entry) => ({
  renderer_id: entry.rendererId,
  name: entry.localName,
  output_format: entry.target,
  output_path: entry.outputPath,
  description: entry.description,
}));

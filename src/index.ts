// ---------------------------------------------------------------------------
// index -- plugin entry module.
//
// The host imports this file, reads `manifest`, and calls `activate` once per
// enable. Registration is the whole of the work: the profile, the validators
// the meta-model cannot express, and the JSON-LD exporter.
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
import type { PluginContext, PluginManifest } from "./host-contract.js";
import { EXPORT_FORMAT, exportJsonLd } from "./exporter.js";
import { PROFILE, PROFILE_RELATION_TYPE_IDS, PROFILE_RESOURCE_TYPE_IDS } from "./profile.js";
import { buildValidators } from "./validators.js";
import { PROFILE_ID } from "./vocabulary.js";

const require = createRequire(import.meta.url);

/** Raised when the entry module cannot find the manifest the host read at discovery. */
export class ManifestNotFoundError extends Error {
  constructor(attempted: readonly string[]) {
    super(`fdpm-plugin.json not found; looked in: ${attempted.join(", ")}`);
    this.name = "ManifestNotFoundError";
  }
}

/**
 * Load the manifest from the file the host also reads at discovery.
 *
 * @remarks
 * Deployed, the manifest sits beside `index.js` because `dist/` is the plugin
 * directory. In this repository it sits one level up, beside `src/`. Both are
 * tried so the module behaves identically under test and under the host, and
 * neither layout silently loads the other's copy.
 *
 * @param candidates - Specifiers to try, in order.
 * @returns The parsed manifest.
 * @throws {@link ManifestNotFoundError} If none of the candidates resolves.
 */
export function loadManifest(
  candidates: readonly string[] = ["./fdpm-plugin.json", "../fdpm-plugin.json"],
): PluginManifest {
  for (const candidate of candidates) {
    try {
      return require(candidate) as PluginManifest;
    } catch {
      continue;
    }
  }
  throw new ManifestNotFoundError(candidates);
}

/** The plugin manifest, as declared in `fdpm-plugin.json`. */
export const manifest: PluginManifest = loadManifest();

/** The domain profile this plugin contributes. */
export { PROFILE };

/**
 * Register everything the manifest declares.
 *
 * Called once per enable, against a cleared contribution set, so it must be
 * deterministic and hold no state between calls.
 *
 * @param ctx - Registration surface supplied by the host.
 */
export function activate(ctx: PluginContext): void {
  ctx.registerProfile(PROFILE);

  const validators = buildValidators(PROFILE_RESOURCE_TYPE_IDS, PROFILE_RELATION_TYPE_IDS);
  const registered = new Set<string>();
  for (const validator of validators) {
    // The host keys a validator on (type, rule); registering the same pair
    // twice would run one check twice and report each finding twice.
    const key = `${validator.type_id}::${validator.rule_id}`;
    if (registered.has(key)) continue;
    registered.add(key);
    ctx.registerValidator(validator);
  }

  ctx.registerExporter({ format: EXPORT_FORMAT, fn: exportJsonLd });

  ctx.log.info(
    `media activated: profile ${PROFILE_ID} v${PROFILE.version} with ` +
      `${PROFILE.primitive_types.length} primitive types, ` +
      `${PROFILE.relation_types.length} relation types, ` +
      `${PROFILE.inline_structs.length} shared structs, ` +
      `${PROFILE.validation_rules.length} CEL rules, ` +
      `${registered.size} code validators, 1 exporter (${EXPORT_FORMAT}).`,
  );
}

/**
 * Release anything held outside the host's contribution set.
 *
 * Registrations are torn down by the host, and this plugin holds nothing else,
 * so deactivation only records that it happened.
 *
 * @param ctx - Registration surface supplied by the host.
 */
export function deactivate(ctx: PluginContext): void {
  ctx.log.info(`media deactivated: ${PROFILE_ID} unregistered.`);
}

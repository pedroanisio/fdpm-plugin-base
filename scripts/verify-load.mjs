// Verify the built plugin loads the way the host loads it: staged as a
// deployment directory, discovered from a FDPM_PLUGIN_PATH search path,
// activated by a real `Host`, and then exercised through it -- a write the
// profile must reject, and an export the host must be able to run.
//
// An earlier version of this script activated against a hand-written context
// object. That object was written from the same assumption as the plugin, so
// it agreed with the plugin about a member name the host does not use, and
// reported success on a plugin the host quarantined on contact. A mock cannot
// falsify a claim about a contract it was derived from. The `Host` below is
// the contract, which is why it is here and the mock is not.

import { cp, mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.env["FDPM_LOG_LEVEL"] ??= "warn";
const { Host, exportTransfer } = await import("@fdpm/cli");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ID = "fdpm.media";
const PROFILE_ID = "profile:media:1.0";
const FORMAT = "media-jsonld";
const RULE = "media:val:identifier-scheme-and-layer";
const TARGET = "text/markdown";
const CATALOGUE = "media:CatalogueRenderer";
const ANNOTATIONS = "media:AnnotationIndexRenderer";

const PROVENANCE = {
  createdAt: "2026-01-01T00:00:00Z",
  createdBy: "agent:verify-load",
  sourceSystem: "verify-load",
  revision: 1,
  generatedByActivity: "activity:verify-load",
};
const BASE = { schemaVersion: "1.0.0", provenance: PROVENANCE };

/**
 * Run every check, collecting failures rather than throwing on the first one,
 * so a broken build reports everything wrong with it in one run.
 *
 * @param pluginDir - Staged deployment directory the host will discover.
 * @param searchPath - The FDPM_PLUGIN_PATH entry containing it.
 * @returns Human-readable failures; empty means the plugin loaded and works.
 */
async function runChecks(pluginDir, searchPath) {
  const failures = [];
  const fail = (m) => failures.push(m);
  const expect = (actual, expected, what) => {
    if (actual !== expected) fail(`${what}: expected ${expected}, got ${actual}`);
  };

  const onDisk = JSON.parse(await readFile(join(root, "fdpm-plugin.json"), "utf8"));
  if (!existsSync(join(pluginDir, "fdpm-plugin.json"))) {
    fail("build did not place fdpm-plugin.json inside dist/; the deployed directory is incomplete");
  }

  const host = new Host({ dataDir: null, pluginPaths: [searchPath] });
  await host.load();

  const discovered = host.plugins.list().find((p) => p.id === PLUGIN_ID);
  if (!discovered) {
    fail(`host did not discover ${PLUGIN_ID} under FDPM_PLUGIN_PATH`);
    return failures;
  }
  expect(discovered.version, onDisk.version, "discovered version");

  // Activation. The step a mock context cannot stand in for: the host supplies
  // its own PluginContext, and a member the plugin invents throws right here.
  await host.plugins.enable(PLUGIN_ID);
  const after = host.plugins.list().find((p) => p.id === PLUGIN_ID);
  if (after.state !== "active") {
    fail(
      `state after enable: expected active, got ${after.state}` +
        (after.errorMessage ? ` -- ${after.errorMessage}` : ""),
    );
    return failures;
  }

  if (!host.profiles.has(PROFILE_ID)) {
    fail(`${PROFILE_ID} is not in the host's profile registry after activation`);
    return failures;
  }
  const profile = host.profiles.getRaw(PROFILE_ID);

  // Counts read off the host's copy, against the module's own declaration.
  const { PROFILE } = await import(new URL("../dist/profile.js", import.meta.url).href);
  for (const key of ["primitive_types", "relation_types", "inline_structs", "validation_rules"]) {
    expect((profile[key] ?? []).length, PROFILE[key].length, `host's ${key}`);
  }

  await host.createProject({ workbook_id: "verify", name: "verify", profile_id: PROFILE_ID });

  /**
   * @returns The findings a write provoked; `null` when the host accepted it.
   */
  const write = async (id, type_id, field_values) => {
    try {
      await host.createPrimitive("verify", { id, type_id, field_values });
      return null;
    } catch (err) {
      return err.findings ?? [];
    }
  };

  // A write the profile must accept ...
  const accepted = await write("manifestation:verify", "media:MusicRelease", {
    ...BASE,
    layer: "manifestation",
    releaseType: "album",
    title: { primaryLocale: "en", values: [{ locale: "en", text: "Verify" }] },
  });
  if (accepted !== null) {
    fail(`a valid MusicRelease was rejected: ${accepted.map((f) => f.rule_id).join(", ")}`);
  }

  // ... and one it must reject, proving the code validators reached the
  // pipeline rather than merely being handed to a recording object. An ISRC
  // names a recording, so declaring it at the manifestation layer is wrong.
  const rejected = await write("identifier:verify-mislayered", "media:Identifier", {
    ...BASE,
    scheme: "isrc",
    value: "USRC17607839",
    addressesLayer: "manifestation",
    identifiesId: "manifestation:verify",
  });
  if (rejected === null) {
    fail(`the host accepted an ISRC declared at the manifestation layer; ${RULE} did not run`);
  } else if (!rejected.some((f) => f.rule_id === RULE)) {
    fail(
      `mislayered identifier rejected, but not by ${RULE}: ${rejected.map((f) => f.rule_id).join(", ")}`,
    );
  }

  // The exporter is reachable and runs against a real transfer.
  if (!host.plugins.findExporter(FORMAT)) {
    fail(`no exporter registered for ${FORMAT}`);
    return failures;
  }
  const bytes = await host.plugins.runExporter(FORMAT, exportTransfer(host, "verify"));
  const doc = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!doc["@context"]) fail(`${FORMAT} output carries no @context`);

  // Renderers. Registration is permission-gated on render:server, so a
  // manifest missing the permission fails inside activate() rather than here
  // -- but a renderer the host never installed fails here, and so does one
  // whose output the §6.5 gate rejects.
  const slice = host.getProject("verify");
  const resolved = host.profiles.getResolved(PROFILE_ID);
  const renderInput = () => ({
    workbookId: "verify",
    primitives: Object.values(slice.primitives),
    relations: Object.values(slice.relations),
    profile: resolved,
  });

  // The resolved profile must carry this plugin's own bindings. When a profile
  // declares none, the registry appends the host's profile-generic renderer
  // instead, and `fdpm render <wb> text/markdown` returns that.
  const boundIds = (resolved.renderers ?? []).map((b) => b.renderer_id);
  for (const id of [CATALOGUE, ANNOTATIONS]) {
    if (!boundIds.includes(id)) fail(`resolved profile declares no binding for ${id}`);
  }

  for (const id of [CATALOGUE, ANNOTATIONS]) {
    if (!host.plugins.findRenderer(TARGET, id)) {
      fail(`no renderer registered for target=${TARGET} rendererId=${id}`);
      return failures;
    }
  }

  // No --renderer-id: the host resolves through the profile's bindings, in
  // declaration order. This is the call `fdpm render verify text/markdown`
  // makes, and it must reach this plugin rather than core's generic renderer.
  const rendered = await host.plugins.runRenderer(TARGET, renderInput());
  expect(rendered.rendererId, CATALOGUE, `default renderer for ${TARGET}`);
  expect(rendered.contentType, TARGET, "catalogue content type");
  const catalogue = new TextDecoder("utf-8", { fatal: true }).decode(rendered.bytes);
  if (!catalogue.includes("manifestation:verify")) {
    fail("the catalogue does not contain the release written into the workbook");
  }
  if (!catalogue.includes(PROFILE_ID)) fail("the catalogue does not name the profile it renders");

  const annotations = await host.plugins.runRenderer(TARGET, renderInput(), {
    rendererId: ANNOTATIONS,
  });
  expect(annotations.rendererId, ANNOTATIONS, "explicitly selected renderer");
  expect(annotations.contentType, TARGET, "annotation index content type");
  new TextDecoder("utf-8", { fatal: true }).decode(annotations.bytes);

  if (failures.length === 0) {
    console.log(
      `OK ${PLUGIN_ID}@${discovered.version} activated by a real Host from a ` +
        `FDPM_PLUGIN_PATH layout: ${PROFILE_ID} registered with ` +
        `${profile.primitive_types.length} primitive types, ` +
        `${profile.relation_types.length} relation types, ` +
        `${(profile.inline_structs ?? []).length} shared structs, ` +
        `${(profile.validation_rules ?? []).length} CEL rules; ` +
        `${RULE} rejected a mislayered identifier; ` +
        `exporter ${FORMAT} produced ${bytes.length} bytes; ` +
        `${TARGET} resolved to ${rendered.rendererId} (${rendered.bytes.length} bytes) ` +
        `and ${ANNOTATIONS} to ${annotations.bytes.length} bytes.`,
    );
  }
  return failures;
}

// The host looks for <dir>/<name>/fdpm-plugin.json with an index.js beside it.
// Copied, not symlinked: a deployed plugin directory is self-contained, and
// reaching back into the repository would prove the wrong thing.
const stage = await mkdtemp(join(tmpdir(), "fdpm-plugin-verify-"));
const searchPath = join(stage, "plugins");
let failures;
try {
  await cp(join(root, "dist"), join(searchPath, "fdpm-media"), { recursive: true });
  failures = await runChecks(join(searchPath, "fdpm-media"), searchPath);
} finally {
  await rm(stage, { recursive: true, force: true });
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exitCode = 1;
}

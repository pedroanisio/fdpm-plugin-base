// Verify the built plugin loads the way the host loads it: discovery from a
// FDPM_PLUGIN_PATH directory, a dynamic import of the entry module, then
// activation against a recording context. A green unit suite proves the
// modules are correct; only this proves the packaging is.

import { cp, mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (m) => {
  console.error(`FAIL ${m}`);
  process.exitCode = 1;
};

// The host looks for <dir>/<name>/fdpm-plugin.json and an index.js beside it,
// so the layout is staged exactly as a deployment would be.
const stage = await mkdtemp(join(tmpdir(), "fdpm-plugin-verify-"));
const pluginDir = join(stage, "fdpm-media");
try {
  // Copied, not symlinked: a deployed plugin directory is self-contained, and
  // reaching back into the repository would prove the wrong thing.
  await cp(join(root, "dist"), pluginDir, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, "fdpm-plugin.json"), "utf8"));
  if (!existsSync(join(pluginDir, "fdpm-plugin.json"))) {
    fail("build did not place fdpm-plugin.json inside dist/; the deployed directory is incomplete");
  }

  const entry = pathToFileURL(join(pluginDir, "index.js")).href;
  const mod = await import(entry);

  if (typeof mod.activate !== "function") fail("entry module exports no activate()");
  if (typeof mod.manifest !== "object" || mod.manifest === null) fail("entry exports no manifest");
  if (mod.manifest.id !== manifest.id) fail("exported manifest id differs from the file on disk");

  const registered = { profiles: [], validators: [], exporters: [], logs: [] };
  const ctx = {
    manifest: mod.manifest,
    log: {
      info: (m) => registered.logs.push(m),
      warn: (m) => registered.logs.push(m),
      error: (m) => registered.logs.push(m),
      debug: (m) => registered.logs.push(m),
    },
    registerProfile: (p) => registered.profiles.push(p),
    registerValidator: (v) => registered.validators.push(v),
    registerExporter: (e) => registered.exporters.push(e),
  };
  await mod.activate(ctx);

  if (registered.profiles.length !== 1)
    fail(`expected 1 profile, got ${registered.profiles.length}`);
  if (registered.exporters.length !== 1) fail("expected 1 exporter");
  if (registered.validators.length === 0) fail("no validators registered");

  // The profile must still satisfy the host's own meta-model after a build.
  const { DomainProfile } = await import("@fdpm/cli");
  const parsed = DomainProfile.safeParse(registered.profiles[0]);
  if (!parsed.success) {
    fail(
      `built profile rejected by the host meta-model:\n${JSON.stringify(parsed.error.issues.slice(0, 5), null, 2)}`,
    );
  }

  if (process.exitCode !== 1) {
    console.log(
      `OK loaded ${mod.manifest.id}@${mod.manifest.version} from FDPM_PLUGIN_PATH layout: ` +
        `${registered.profiles[0].primitive_types.length} primitive types, ` +
        `${registered.profiles[0].relation_types.length} relation types, ` +
        `${new Set(registered.validators.map((v) => v.rule_id)).size} validator rules, ` +
        `${registered.exporters.length} exporter.`,
    );
  }
} finally {
  await rm(stage, { recursive: true, force: true });
}

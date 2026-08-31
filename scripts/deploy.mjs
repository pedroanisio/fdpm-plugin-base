// Copy the built plugin into the first FDPM_PLUGIN_PATH entry, under the
// directory name the host discovers.
//
// Discovery reads `<entry>/<name>/fdpm-plugin.json` and skips anything that is
// not a real directory -- `fs.readdir(..., { withFileTypes: true })` reports a
// symlink as a symlink, not a directory, so a symlinked deployment is silently
// invisible to the host. Hence a copy, and hence re-running this after a build.

import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR_NAME = "fdpm-media";

const search = (process.env["FDPM_PLUGIN_PATH"] ?? "")
  .split(delimiter)
  .map((s) => s.trim())
  .filter(Boolean);

if (search.length === 0) {
  console.error(
    "FAIL FDPM_PLUGIN_PATH is unset. Source the .env first:\n" +
      "  set -a; . .env; set +a; npm run deploy",
  );
  process.exit(1);
}

const dist = join(root, "dist");
if (!existsSync(join(dist, "fdpm-plugin.json"))) {
  console.error("FAIL dist/ is missing or incomplete; run `npm run build` first.");
  process.exit(1);
}

const target = join(search[0], DIR_NAME);
await mkdir(search[0], { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(dist, target, { recursive: true });

console.log(`deployed ${DIR_NAME} -> ${target}`);
console.log(
  "The host discovers it on next start. Without a matching FDPM_TRUSTED_KEYS " +
    "entry it registers as `community` and stays disabled.",
);

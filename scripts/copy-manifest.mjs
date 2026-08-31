// Place the manifest beside the built entry module, so `dist/` is the whole
// deployable plugin directory: the host reads <dir>/fdpm-plugin.json at
// discovery and imports <dir>/index.js at load, and both must be present.

import { copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await copyFile(join(root, "fdpm-plugin.json"), join(root, "dist", "fdpm-plugin.json"));

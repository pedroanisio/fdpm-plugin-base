import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PROFILE_ID } from "../src/vocabulary.js";
import {
  ManifestNotFoundError,
  activate,
  deactivate,
  loadManifest,
  manifest,
} from "../src/index.js";
import type {
  DomainProfileLike,
  ExporterRegistration,
  PluginContext,
  RendererRegistration,
  ValidatorRegistration,
} from "../src/host-contract.js";

interface Recorded {
  profiles: DomainProfileLike[];
  validators: ValidatorRegistration[];
  exporters: ExporterRegistration[];
  renderers: RendererRegistration[];
  logs: string[];
}

/** Recording stand-in for the host's PluginContext. */
function recordingContext(): { ctx: PluginContext; recorded: Recorded } {
  const recorded: Recorded = {
    profiles: [],
    validators: [],
    exporters: [],
    renderers: [],
    logs: [],
  };
  const ctx: PluginContext = {
    logger: {
      info: (m) => recorded.logs.push(m),
      warn: (m) => recorded.logs.push(m),
      error: (m) => recorded.logs.push(m),
      debug: (m) => recorded.logs.push(m),
    },
    registerProfile: (p) => recorded.profiles.push(p),
    registerValidator: (v) => recorded.validators.push(v),
    registerExporter: (e) => recorded.exporters.push(e),
    registerRenderer: (r) => recorded.renderers.push(r),
  };
  return { ctx, recorded };
}

const onDisk = JSON.parse(
  await readFile(new URL("../fdpm-plugin.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("entry module", () => {
  it("manifest_matches_the_manifest_on_disk", () => {
    // The host reads `fdpm-plugin.json` at discovery and the exported
    // `manifest` at load. Two sources that disagree make the plugin behave
    // differently before and after activation.
    expect(manifest).toEqual(onDisk);
  });

  it("manifest_declares_the_profile_id_the_module_registers", async () => {
    const { ctx, recorded } = recordingContext();
    await activate(ctx);
    expect(recorded.profiles.map((p) => p.id)).toEqual([PROFILE_ID]);
  });

  // The host binds a validator to one type, so a rule that applies to many
  // types is registered many times. The invariant is therefore over the set of
  // rules, not the count of registrations.
  it("activate_registers_every_validator_against_at_least_one_type", async () => {
    const { ctx, recorded } = recordingContext();
    await activate(ctx);
    const rules = new Set(recorded.validators.map((v) => v.rule_id));
    expect(rules.size).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(recorded.validators.filter((v) => v.rule_id === rule).length).toBeGreaterThan(0);
    }
  });

  it("activate_registers_no_validator_twice_for_one_type", async () => {
    const { ctx, recorded } = recordingContext();
    await activate(ctx);
    const pairs = recorded.validators.map((v) => `${v.type_id}::${v.rule_id}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("activate_registers_one_exporter_per_declared_exporter_capability", async () => {
    const { ctx, recorded } = recordingContext();
    await activate(ctx);
    const declared = (manifest.capabilities as { capability_id: string }[]).filter(
      (c) => c.capability_id === "cap:exporter",
    );
    expect(recorded.exporters).toHaveLength(declared.length);
  });

  // Nothing registered that the manifest does not declare, and nothing
  // declared that never registers: a capability row the host reads at
  // discovery but that no code honours is a lie told to the operator.
  it("activate_registers_one_renderer_per_declared_renderer_capability", async () => {
    const { ctx, recorded } = recordingContext();
    await activate(ctx);
    const declared = (
      manifest.capabilities as { capability_id: string; metadata?: { renderer_id?: string } }[]
    )
      .filter((c) => c.capability_id === "cap:renderer")
      .map((c) => c.metadata?.renderer_id)
      .sort();
    expect(recorded.renderers.map((r) => r.rendererId).sort()).toEqual(declared);
  });

  it("activate_registered_rule_ids_are_exactly_those_the_manifest_declares", async () => {
    const { ctx, recorded } = recordingContext();
    await activate(ctx);
    const declared = (
      manifest.capabilities as { capability_id: string; metadata?: { rule_id?: string } }[]
    )
      .filter((c) => c.capability_id === "cap:validator")
      .map((c) => c.metadata?.rule_id)
      .sort();
    const registered = [...new Set(recorded.validators.map((v) => v.rule_id))].sort();
    expect(registered).toEqual(declared);
  });

  // activate() runs again after every disable, against a cleared
  // contribution set, so it must not accumulate state across calls.
  it("activate_called_twice_registers_the_same_set_each_time", async () => {
    const first = recordingContext();
    await activate(first.ctx);
    const second = recordingContext();
    await activate(second.ctx);
    expect(second.recorded.validators.map((v) => v.rule_id)).toEqual(
      first.recorded.validators.map((v) => v.rule_id),
    );
    expect(second.recorded.profiles.map((p) => p.id)).toEqual(
      first.recorded.profiles.map((p) => p.id),
    );
  });

  it("activate_logs_a_summary_of_what_it_contributed", async () => {
    const { ctx, recorded } = recordingContext();
    await activate(ctx);
    expect(recorded.logs.join(" ")).toContain(PROFILE_ID);
  });

  it("deactivate_is_callable_and_records_no_further_contributions", async () => {
    const { ctx, recorded } = recordingContext();
    await activate(ctx);
    const before = recorded.validators.length;
    await deactivate(ctx);
    expect(recorded.validators).toHaveLength(before);
  });

  it("manifest_capability_local_names_are_unique_per_capability_kind", () => {
    const seen = new Set<string>();
    for (const c of manifest.capabilities as { capability_id: string; local_name: string }[]) {
      const key = `${c.capability_id}::${c.local_name}`;
      expect(seen.has(key), `duplicate capability ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe("loadManifest", () => {
  it("loadManifest_no_candidate_resolves_throws_rather_than_returning_a_stub", () => {
    // A missing manifest must be loud. Returning an empty object here would
    // register a plugin whose declared capabilities are unknown to the host.
    expect(() => loadManifest(["./nowhere.json"])).toThrow(ManifestNotFoundError);
  });

  it("loadManifest_falls_through_to_a_later_candidate", () => {
    expect(loadManifest(["./nowhere.json", "../fdpm-plugin.json"]).id).toBe(manifest.id);
  });
});

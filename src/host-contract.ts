// ---------------------------------------------------------------------------
// host-contract -- the slice of the FDPM host surface this plugin depends on.
//
// `@fdpm/cli` exports its meta-model but not `PluginContext`, and its package
// `exports` map blocks deep imports. The registration surface is therefore
// declared here structurally: the host's real context satisfies it, and the
// plugin keeps compiling when the host's internal paths move. Nothing in this
// module is imported at runtime -- the host injects the context.
// ---------------------------------------------------------------------------

import type {
  DomainProfile,
  PrimitiveInstance,
  ProjectTransfer,
  RelationInstance,
  ValidationFinding,
} from "@fdpm/cli";

/** Profile shape handed to {@link PluginContext.registerProfile}. */
export type DomainProfileLike = DomainProfile;

/** Workbook slice a validator reads to check a constraint spanning primitives. */
export interface ValidatorContext {
  relations: readonly RelationInstance[];
  workbook?: {
    readonly primitives: Readonly<Record<string, PrimitiveInstance>>;
    readonly relations: Readonly<Record<string, RelationInstance>>;
  };
}

/**
 * Judge one written instance and return every finding it provokes.
 *
 * @param instance - The primitive or relation being created, replaced or patched.
 * @param type - The type definition the host resolved for `instance`.
 * @param profile - The profile the write validates against.
 * @param context - Workbook slice; absent when the pipeline runs outside a workbook.
 * @returns Findings to attach to the write. An empty array accepts it.
 */
export type ValidatorFn = (
  instance: PrimitiveInstance | RelationInstance,
  type?: unknown,
  profile?: unknown,
  context?: ValidatorContext,
) => ValidationFinding[];

/** Binding of one validator function to the type and rule id it reports under. */
export interface ValidatorRegistration {
  type_id: string;
  rule_id: string;
  fn: ValidatorFn;
}

/** Binding of one exporter function to the format token that selects it. */
export interface ExporterRegistration {
  format: string;
  fn: (transfer: ProjectTransfer) => Uint8Array;
}

/** Host logger; messages reach the CLI's diagnostic channel. */
export interface PluginLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/** Registration surface handed to {@link activate} once per enable. */
export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly log: PluginLogger;
  registerProfile(profile: DomainProfileLike): void;
  registerValidator(registration: ValidatorRegistration): void;
  registerExporter(registration: ExporterRegistration): void;
}

/** One capability row of `fdpm-plugin.json`. */
export interface CapabilityDeclaration {
  capability_id: string;
  local_name: string;
  entry?: string;
  metadata?: Record<string, unknown>;
}

/** Parsed `fdpm-plugin.json`, as the host reads it at discovery. */
export interface PluginManifest {
  id: string;
  version: string;
  spec_version: string;
  kind: string;
  name: string;
  description: string;
  authors: string[];
  license: string;
  host_compatibility: Record<string, string>;
  permissions: string[];
  capabilities: CapabilityDeclaration[];
  trust?: { signed_by?: string; signature?: string; supply_chain_sbom?: string };
}

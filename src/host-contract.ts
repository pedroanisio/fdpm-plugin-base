// ---------------------------------------------------------------------------
// host-contract -- the slice of the FDPM host surface this plugin depends on.
//
// `@fdpm/cli` exports its meta-model but not `PluginContext`, and its package
// `exports` map blocks deep imports. The registration surface is therefore
// declared here structurally. That the host satisfies it is a claim this file
// cannot make good on by itself -- it is checked by activating against a real
// `Host` in `scripts/verify-load.mjs`, which is the only place the claim can
// fail. Nothing here is imported at runtime; the host injects the context.
// ---------------------------------------------------------------------------

import type {
  DomainProfile,
  PrimitiveInstance,
  ProjectTransfer,
  RelationInstance,
  ValidationFinding,
  Workbook,
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

/**
 * Workbook slice a renderer reads.
 *
 * @remarks
 * `workbook` and `renderedAt` are optional on the signature because the host
 * fills them in only when the render runs against a stored workbook; a direct
 * caller supplies neither. A renderer that needs one must therefore handle its
 * absence rather than assume the host was there.
 */
export interface RendererInput {
  workbookId: string;
  /** ISO-8601 snapshot time. The host supplies one per invocation. */
  renderedAt?: string;
  workbook?: Workbook;
  primitives: readonly PrimitiveInstance[];
  relations: readonly RelationInstance[];
  profile: DomainProfile;
}

/**
 * One problem the render could not resolve.
 *
 * @remarks
 * The host's finding shape is the template DSL's, because the DSL was the
 * only thing that used to produce findings. These renderers use no template,
 * so `templateId` carries the renderer id and `line`/`column` are zero, and
 * `expression` names the field or record that failed to resolve. The channel
 * is load-bearing rather than decorative: `fdpm render --strict` sets a
 * verification exit code when any finding is present, which is how a broken
 * catalogue fails a pipeline instead of rendering a quietly wrong document.
 */
export interface RenderFinding {
  kind: "render-error";
  templateId: string;
  line: number;
  column: number;
  expression: string;
  message: string;
}

/**
 * Bytes a renderer produced, with the type it claims for them.
 *
 * @remarks
 * `contentType` MUST equal the `target` the renderer registered under. The
 * host rejects the output otherwise (SPEC-CORE 6.5) -- a renderer cannot lie
 * about what it produced.
 */
export interface RendererOutput {
  bytes: Uint8Array;
  contentType: string;
  filename?: string;
  findings?: RenderFinding[];
}

/** Produce one rendered artifact from a workbook slice. */
export type RendererFn = (input: RendererInput) => RendererOutput;

/** Binding of one renderer function to the target and id that select it. */
export interface RendererRegistration {
  target: string;
  rendererId: string;
  fn: RendererFn;
}

/**
 * Host logger; messages reach the CLI's diagnostic channel.
 *
 * @remarks
 * Reached as `ctx.logger`, not `ctx.log`. The host names this member `logger`
 * (SPEC-CORE 6.2 `PluginContext`), and an entry module that guesses the name
 * throws inside `activate` and is quarantined before its profile survives.
 */
export interface PluginLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Registration surface handed to {@link activate} once per enable.
 *
 * @remarks
 * A structural subset of the host's `PluginContext`: it declares the members
 * this plugin reads and nothing else. Declaring a member the host does not
 * supply is the failure mode this interface exists to prevent -- it type-checks
 * against the plugin's own mocks and throws against the host. `scripts/verify-load.mjs`
 * activates against a real `Host` for exactly that reason; a mock cannot
 * falsify a claim about a contract it was written from.
 */
export interface PluginContext {
  readonly logger: PluginLogger;
  registerProfile(profile: DomainProfileLike): void;
  registerValidator(registration: ValidatorRegistration): void;
  registerExporter(registration: ExporterRegistration): void;
  registerRenderer(registration: RendererRegistration): void;
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

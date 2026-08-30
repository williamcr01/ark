# @ark/ai

**One job:** the provider and model abstraction Ark runs the agent on top of. Everything that knows
which LLM providers exist, how to authenticate to them, and how to translate Ark's settings into
provider options lives here — and nothing else does.

Layer 1. May import `@ark/telemetry`. Must not import `@ark/contracts` or anything above it.

| Module                    | Responsibility                                              |
| ------------------------- | ----------------------------------------------------------- |
| `provider-id.ts`          | The provider enum, labels, and env-var names                |
| `reasoning-effort.ts`     | The effort-level enum and labels                            |
| `model-info.ts`           | The `ModelInfo` shape advertised to the client              |
| `provider-error-code.ts`  | Failure codes this package can produce                      |
| `model-catalog.ts`        | The pinned catalog of models and their reasoning transports |
| `models.ts`               | Model listing, resolution, and the default model            |
| `credentials.ts`          | API key resolution behind an injectable source              |
| `provider-runtime.ts`     | Builds the AI SDK model instance for a provider             |
| `provider-options.ts`     | The `providerOptions` shape shared by the options builders  |
| `reasoning-options.ts`    | Effort level → provider-specific thinking options           |
| `prompt-cache-options.ts` | Provider prompt-cache control                               |
| `provider-errors.ts`      | Categorises provider and asset-proxy failures               |
| `token-usage.ts`          | Accumulates token usage across agent steps                  |

**Vocabulary lives here, not in `@ark/contracts`.** `providerIdSchema`, `reasoningEffortSchema`, and
`modelInfoSchema` are defined here and re-exported by `@ark/contracts`, so the renderer keeps
importing them from `@ark/contracts` as before. `apiErrorCodeSchema` in contracts widens
`providerErrorCodeSchema` with the storage/workspace codes.

The Electron `safeStorage` key source is injected at boot through `setProviderApiKeySource`; this
package never touches the filesystem or Electron.

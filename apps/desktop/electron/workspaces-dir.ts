/**
 * Where Electron should point `ARK_WORKSPACES_DIR` before Settings load.
 *
 * Packaged builds always start at Documents/Ark (then Settings may override).
 * Unpackaged builds honor `ARK_PROFILE_WORKSPACES_DIR`, then `ARK_WORKSPACES_DIR`,
 * so the editor-drag profiler can pin a real-disk path without redirecting a
 * installed app's workspace folder from the process environment.
 */
export function resolveDesktopWorkspacesDir(options: {
  isPackaged: boolean
  documentsArk: string
  env: NodeJS.Dict<string | undefined>
}): { directory: string; usedEnvOverride: boolean } {
  if (!options.isPackaged) {
    const profile = options.env.ARK_PROFILE_WORKSPACES_DIR?.trim()
    if (profile) {
      return { directory: profile, usedEnvOverride: true }
    }

    const override = options.env.ARK_WORKSPACES_DIR?.trim()
    if (override) {
      return { directory: override, usedEnvOverride: true }
    }
  }

  return { directory: options.documentsArk, usedEnvOverride: false }
}

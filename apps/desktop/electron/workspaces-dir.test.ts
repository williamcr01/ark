import { describe, expect, it } from 'vitest'

import { resolveDesktopWorkspacesDir } from './workspaces-dir.ts'

const documentsArk = '/Users/me/Documents/Ark'

describe('resolveDesktopWorkspacesDir', () => {
  it('uses Documents/Ark in packaged builds even when env overrides are set', () => {
    expect(
      resolveDesktopWorkspacesDir({
        isPackaged: true,
        documentsArk,
        env: {
          ARK_WORKSPACES_DIR: '/tmp/evil-workspaces',
          ARK_PROFILE_WORKSPACES_DIR: '/tmp/profile-workspaces',
        },
      }),
    ).toEqual({ directory: documentsArk, usedEnvOverride: false })
  })

  it('prefers ARK_PROFILE_WORKSPACES_DIR in unpackaged builds', () => {
    expect(
      resolveDesktopWorkspacesDir({
        isPackaged: false,
        documentsArk,
        env: {
          ARK_WORKSPACES_DIR: '/tmp/generic-workspaces',
          ARK_PROFILE_WORKSPACES_DIR: '/mnt/disk/workspaces',
        },
      }),
    ).toEqual({ directory: '/mnt/disk/workspaces', usedEnvOverride: true })
  })

  it('honors ARK_WORKSPACES_DIR in unpackaged builds when the profile var is absent', () => {
    expect(
      resolveDesktopWorkspacesDir({
        isPackaged: false,
        documentsArk,
        env: { ARK_WORKSPACES_DIR: '/tmp/dev-workspaces' },
      }),
    ).toEqual({ directory: '/tmp/dev-workspaces', usedEnvOverride: true })
  })

  it('ignores blank env values and falls back to Documents/Ark', () => {
    expect(
      resolveDesktopWorkspacesDir({
        isPackaged: false,
        documentsArk,
        env: { ARK_WORKSPACES_DIR: '  ', ARK_PROFILE_WORKSPACES_DIR: '' },
      }),
    ).toEqual({ directory: documentsArk, usedEnvOverride: false })
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DesktopSettingsDialog } from './DesktopSettingsDialog'

describe('DesktopSettingsDialog', () => {
  afterEach(() => vi.restoreAllMocks())

  it('tests a provider key through the preload bridge', async () => {
    const test = vi.fn().mockResolvedValue({ ok: true, modelCount: 12 })
    window.arkDesktop = {
      credentials: {
        list: vi.fn().mockResolvedValue({
          openai: { configured: false, storage: null },
          anthropic: { configured: false, storage: null },
          google: { configured: false, storage: null },
        }),
        save: vi.fn(),
        saveSession: vi.fn(),
        remove: vi.fn(),
        test,
      },
      settings: { get: vi.fn(), update: vi.fn() },
      updates: { check: vi.fn() },
    }

    render(
      <DesktopSettingsDialog
        appearancePreference="system"
        onAppearanceChange={vi.fn()}
        onCredentialsChanged={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    )
    expect(document.querySelectorAll('[data-provider-logo]')).toHaveLength(3)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('OpenAI'), 'sk-test')
    await user.click(screen.getAllByRole('button', { name: 'Test' })[0]!)

    expect(test).toHaveBeenCalledWith('openai', 'sk-test')
    expect(await screen.findByText(/12 models are available/)).toBeInTheDocument()
  })

  it('changes appearance from Settings', async () => {
    const onAppearanceChange = vi.fn()
    window.arkDesktop = {
      credentials: {
        list: vi.fn().mockResolvedValue({
          openai: { configured: false, storage: null },
          anthropic: { configured: false, storage: null },
          google: { configured: false, storage: null },
        }),
        save: vi.fn(),
        saveSession: vi.fn(),
        remove: vi.fn(),
        test: vi.fn(),
      },
      settings: { get: vi.fn(), update: vi.fn() },
      updates: { check: vi.fn() },
    }

    render(
      <DesktopSettingsDialog
        appearancePreference="system"
        onAppearanceChange={onAppearanceChange}
        onCredentialsChanged={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    )

    await userEvent.click(screen.getByLabelText('Dark theme'))

    expect(onAppearanceChange).toHaveBeenCalledWith('dark')
  })

  it('can keep a provider key in memory for the current session', async () => {
    const saveSession = vi.fn().mockResolvedValue({ ok: true })
    window.arkDesktop.credentials.saveSession = saveSession

    render(
      <DesktopSettingsDialog
        appearancePreference="system"
        onAppearanceChange={vi.fn()}
        onCredentialsChanged={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    )
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('OpenAI'), 'sk-session')
    await user.click(screen.getAllByRole('button', { name: 'Use for session' })[0]!)

    expect(saveSession).toHaveBeenCalledWith('openai', 'sk-session')
    expect(await screen.findByText(/kept until Ark quits/)).toBeInTheDocument()
  })
})

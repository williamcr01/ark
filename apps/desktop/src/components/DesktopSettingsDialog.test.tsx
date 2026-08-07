import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DesktopSettingsDialog } from './DesktopSettingsDialog'

async function switchTab(label: string) {
  await userEvent.click(screen.getByRole('tab', { name: label }))
}

describe('DesktopSettingsDialog', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('tests a provider key through the preload bridge', async () => {
    const test = vi.fn().mockResolvedValue({ ok: true, modelCount: 12 })
    window.arkDesktop = {
      mcp: window.arkDesktop.mcp,
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
      settings: {
        get: vi.fn().mockResolvedValue({ defaultWorkspaceDirectory: null }),
        update: vi.fn(),
      },
      updates: { check: vi.fn() },
      files: {
        openWorkspace: vi.fn(),
        chooseWorkspacePath: vi.fn(),
        chooseDirectory: vi.fn(),
        reveal: vi.fn(),
      },
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
    const user = userEvent.setup()
    await switchTab('AI Providers')
    expect(document.querySelectorAll('[data-provider-logo]')).toHaveLength(3)
    await user.type(screen.getByLabelText('OpenAI'), 'sk-test')
    await user.click(screen.getAllByRole('button', { name: 'Test' })[0]!)

    expect(test).toHaveBeenCalledWith('openai', 'sk-test')
    expect(await screen.findByText(/12 models are available/)).toBeInTheDocument()
  })

  it('changes appearance from Settings', async () => {
    const onAppearanceChange = vi.fn()
    window.arkDesktop = {
      mcp: window.arkDesktop.mcp,
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
      settings: {
        get: vi.fn().mockResolvedValue({ defaultWorkspaceDirectory: null }),
        update: vi.fn(),
      },
      updates: { check: vi.fn() },
      files: {
        openWorkspace: vi.fn(),
        chooseWorkspacePath: vi.fn(),
        chooseDirectory: vi.fn(),
        reveal: vi.fn(),
      },
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
    await switchTab('AI Providers')
    await user.type(screen.getByLabelText('OpenAI'), 'sk-session')
    await user.click(screen.getAllByRole('button', { name: 'Use for session' })[0]!)

    expect(saveSession).toHaveBeenCalledWith('openai', 'sk-session')
    expect(await screen.findByText(/kept until Ark quits/)).toBeInTheDocument()
  })

  it('toggles modal prompts for the normal agent', async () => {
    const update = vi.fn().mockResolvedValue({
      agentInteractionsInModal: true,
      defaultWorkspaceDirectory: null,
    })
    const onChange = vi.fn()
    window.arkDesktop.settings.get = vi.fn().mockResolvedValue({
      agentInteractionsInModal: false,
      defaultWorkspaceDirectory: null,
    })
    window.arkDesktop.settings.update = update

    render(
      <DesktopSettingsDialog
        appearancePreference="system"
        onAgentInteractionsInModalChange={onChange}
        onAppearanceChange={vi.fn()}
        onCredentialsChanged={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Show Ark agent prompts in a modal' })
    expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)

    expect(update).toHaveBeenCalledWith({ agentInteractionsInModal: true })
    expect(onChange).toHaveBeenCalledWith(true)
    expect(checkbox).toBeChecked()
  })

  it('starts MCP and shows copyable client commands', async () => {
    const running = {
      state: 'running' as const,
      autoStart: false,
      activeDeckId: 'e703d7b8-b612-451c-89b2-347b0eae4643',
      activeDeckTitle: 'The Curious World of Pigs',
      connectedClient: 'Codex',
      lastActivity: {
        clientName: 'Codex',
        toolName: 'read_deck',
        summary: '{"deckId":"e703d7b8-b612-451c-89b2-347b0eae4643"}',
        occurredAt: '2026-08-06T12:00:00.000Z',
      },
      error: null,
    }
    window.arkDesktop.mcp.start = vi.fn().mockResolvedValue(running)
    window.arkDesktop.mcp.getSetupCommands = vi.fn().mockResolvedValue({
      codex: 'codex mcp add ark -- "/path/to/Ark" --mcp',
      claudeCode: 'claude mcp add --transport stdio --scope user ark -- "/path/to/Ark" --mcp',
    })
    window.arkDesktop.mcp.copySetupCommand = vi.fn().mockResolvedValue(undefined)

    render(
      <DesktopSettingsDialog
        appearancePreference="system"
        onAppearanceChange={vi.fn()}
        onCredentialsChanged={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    )
    await switchTab('MCP')
    await userEvent.click(screen.getByRole('button', { name: 'Start MCP server' }))

    expect(window.arkDesktop.mcp.start).toHaveBeenCalledOnce()
    expect(await screen.findByLabelText('Codex setup command')).toHaveValue(
      'codex mcp add ark -- "/path/to/Ark" --mcp',
    )
    expect(screen.queryByText(/Sharing:|e703d7b8/)).not.toBeInTheDocument()

    const copyButton = screen.getByRole('button', { name: 'Copy Codex setup command' })
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(copyButton)
      await Promise.resolve()
    })

    expect(window.arkDesktop.mcp.copySetupCommand).toHaveBeenCalledWith(
      'codex mcp add ark -- "/path/to/Ark" --mcp',
    )
    expect(copyButton).toHaveTextContent('Copied')

    act(() => vi.advanceTimersByTime(5_000))
    expect(copyButton).toHaveTextContent('Copy')
  })
})

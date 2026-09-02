import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DesktopSettingsDialog } from './DesktopSettingsDialog'

async function switchTab(label: string) {
  await userEvent.click(screen.getByRole('tab', { name: label }))
}

const unconfiguredCredentials = {
  openai: { configured: false, storage: null },
  anthropic: { configured: false, storage: null },
  google: { configured: false, storage: null },
  openrouter: { configured: false, storage: null },
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
        list: vi.fn().mockResolvedValue(unconfiguredCredentials),
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
      export: { create: vi.fn() },
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
    expect(screen.getByLabelText('OpenAI')).toBeInTheDocument()
    expect(screen.getByLabelText('Anthropic')).toBeInTheDocument()
    expect(screen.getByLabelText('Google Gemini')).toBeInTheDocument()
    expect(screen.getByLabelText('OpenRouter')).toBeInTheDocument()
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
        list: vi.fn().mockResolvedValue(unconfiguredCredentials),
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
      export: { create: vi.fn() },
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

  it('starts MCP and shows client Add/Remove/Update rows', async () => {
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
    window.arkDesktop.mcp.getClientInstallations = vi.fn().mockResolvedValue([
      { clientId: 'codex', status: 'notInstalled' },
      { clientId: 'claudeCode', status: 'installed' },
      { clientId: 'grok', status: 'needsUpdate' },
      { clientId: 'cursor', status: 'unavailable', error: 'Install the Cursor CLI.' },
      { clientId: 'openCode', status: 'notInstalled' },
      { clientId: 'devinCli', status: 'installed' },
    ])
    window.arkDesktop.mcp.addClient = vi.fn().mockResolvedValue({
      clientId: 'codex',
      status: 'installed',
    })

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
    await waitFor(() => {
      expect(window.arkDesktop.mcp.getClientInstallations).toHaveBeenCalledOnce()
    })
    expect(window.arkDesktop.mcp.addClient).not.toHaveBeenCalled()
    expect(window.arkDesktop.mcp.removeClient).not.toHaveBeenCalled()
    expect(window.arkDesktop.mcp.updateClient).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Start MCP server' }))

    expect(window.arkDesktop.mcp.start).toHaveBeenCalledOnce()
    expect(await screen.findByRole('group', { name: 'Codex' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Claude Code' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Grok' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Cursor' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'OpenCode' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Devin CLI' })).toBeInTheDocument()
    expect(screen.queryByText(/Sharing:|e703d7b8/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/setup command/i)).not.toBeInTheDocument()

    await userEvent.click(
      within(screen.getByRole('group', { name: 'Codex' })).getByRole('button', { name: 'Add' }),
    )
    expect(window.arkDesktop.mcp.addClient).toHaveBeenCalledWith('codex')
    expect(await screen.findByText('Codex installed.')).toBeInTheDocument()
  })

  it('saves and removes an OpenRouter key through the same credentials bridge', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, modelCount: 4 })
    const remove = vi.fn().mockResolvedValue({ ok: true })
    const onCredentialsChanged = vi.fn().mockResolvedValue(undefined)
    window.arkDesktop.credentials.list = vi
      .fn()
      .mockResolvedValueOnce(unconfiguredCredentials)
      .mockResolvedValueOnce({
        ...unconfiguredCredentials,
        openrouter: { configured: true, storage: 'persistent' },
      })
      .mockResolvedValueOnce(unconfiguredCredentials)
    window.arkDesktop.credentials.save = save
    window.arkDesktop.credentials.remove = remove

    render(
      <DesktopSettingsDialog
        appearancePreference="system"
        onAppearanceChange={vi.fn()}
        onCredentialsChanged={onCredentialsChanged}
        onOpenChange={vi.fn()}
        open
      />,
    )
    const user = userEvent.setup()
    await switchTab('AI Providers')
    await user.type(screen.getByLabelText('OpenRouter'), 'or-test-key')
    await user.click(screen.getAllByRole('button', { name: 'Save' })[3]!)

    expect(save).toHaveBeenCalledWith('openrouter', 'or-test-key')
    expect(onCredentialsChanged).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/OpenRouter key saved/)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(remove).toHaveBeenCalledWith('openrouter')
    expect(onCredentialsChanged).toHaveBeenCalledTimes(2)
  })

  it('tests an OpenRouter key through the same credentials bridge without refreshing the catalog', async () => {
    const test = vi.fn().mockResolvedValue({ ok: true, modelCount: 8 })
    const onCredentialsChanged = vi.fn()
    window.arkDesktop.credentials.list = vi.fn().mockResolvedValue(unconfiguredCredentials)
    window.arkDesktop.credentials.test = test

    render(
      <DesktopSettingsDialog
        appearancePreference="system"
        onAppearanceChange={vi.fn()}
        onCredentialsChanged={onCredentialsChanged}
        onOpenChange={vi.fn()}
        open
      />,
    )
    const user = userEvent.setup()
    await switchTab('AI Providers')
    await user.type(screen.getByLabelText('OpenRouter'), 'or-test-key')
    await user.click(screen.getAllByRole('button', { name: 'Test' })[3]!)

    expect(test).toHaveBeenCalledWith('openrouter', 'or-test-key')
    expect(onCredentialsChanged).not.toHaveBeenCalled()
    expect(await screen.findByText(/8 models are available/)).toBeInTheDocument()
  })

  it('surfaces catalog list warnings without inventing missing_api_key rows', async () => {
    render(
      <DesktopSettingsDialog
        appearancePreference="system"
        catalogWarnings={['Could not list OpenAI models.']}
        onAppearanceChange={vi.fn()}
        onCredentialsChanged={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    )
    await switchTab('AI Providers')

    expect(screen.getByText('Model catalog notice')).toBeInTheDocument()
    expect(screen.getByText('Could not list OpenAI models.')).toBeInTheDocument()
    expect(screen.queryByText('No API key')).not.toBeInTheDocument()
    expect(screen.queryByText(/missing_api_key/)).not.toBeInTheDocument()
  })
})

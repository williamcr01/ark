import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  MCP_CLIENT_IDS,
  type McpClientId,
  type McpClientInstallation,
  type McpStatus,
} from '@ark/contracts'

import { McpSettingsSection } from './McpSettingsSection'

const RUNNING_STATUS: McpStatus = {
  state: 'running',
  autoStart: false,
  activeDeckId: 'e703d7b8-b612-451c-89b2-347b0eae4643',
  activeDeckTitle: 'The Curious World of Pigs',
  connectedClient: 'Codex',
  lastActivity: null,
  error: null,
}

function mockInstallations(
  overrides: Partial<Record<McpClientId, Partial<McpClientInstallation>>> = {},
): McpClientInstallation[] {
  const defaults: Record<McpClientId, McpClientInstallation['status']> = {
    codex: 'notInstalled',
    claudeCode: 'installed',
    grok: 'needsUpdate',
    cursor: 'unavailable',
    openCode: 'notInstalled',
    devinCli: 'installed',
  }
  return MCP_CLIENT_IDS.map((clientId) => ({
    clientId,
    status: defaults[clientId],
    ...(clientId === 'cursor' ? { error: 'Install the Cursor CLI.' } : {}),
    ...overrides[clientId],
  }))
}

function mockMcp(installations = mockInstallations(), status: McpStatus = RUNNING_STATUS) {
  window.arkDesktop.mcp.getStatus = vi.fn().mockResolvedValue(status)
  window.arkDesktop.mcp.getClientInstallations = vi.fn().mockResolvedValue(installations)
  window.arkDesktop.mcp.addClient = vi.fn()
  window.arkDesktop.mcp.removeClient = vi.fn()
  window.arkDesktop.mcp.updateClient = vi.fn()
}

describe('McpSettingsSection', () => {
  it('loads installations on open without writing client configs', async () => {
    mockMcp()
    const onMessage = vi.fn()
    render(<McpSettingsSection onMessage={onMessage} open />)

    expect(await screen.findByRole('group', { name: 'Codex' })).toBeInTheDocument()
    expect(window.arkDesktop.mcp.getClientInstallations).toHaveBeenCalledOnce()
    expect(window.arkDesktop.mcp.addClient).not.toHaveBeenCalled()
    expect(window.arkDesktop.mcp.removeClient).not.toHaveBeenCalled()
    expect(window.arkDesktop.mcp.updateClient).not.toHaveBeenCalled()
  })

  it('renders one row per client with status labels and the matching actions', async () => {
    mockMcp()
    render(<McpSettingsSection onMessage={vi.fn()} open />)

    const codex = await screen.findByRole('group', { name: 'Codex' })
    expect(within(codex).getByText('Not installed')).toBeInTheDocument()
    expect(within(codex).getByRole('button', { name: 'Add' })).toBeEnabled()

    const claude = screen.getByRole('group', { name: 'Claude Code' })
    expect(within(claude).getByText('Installed')).toBeInTheDocument()
    expect(within(claude).getByRole('button', { name: 'Remove' })).toBeEnabled()
    expect(within(claude).queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()

    const grok = screen.getByRole('group', { name: 'Grok' })
    expect(within(grok).getByText('Needs update')).toBeInTheDocument()
    expect(within(grok).getByRole('button', { name: 'Update' })).toBeEnabled()
    expect(within(grok).getByRole('button', { name: 'Remove' })).toBeEnabled()

    const cursor = screen.getByRole('group', { name: 'Cursor' })
    expect(within(cursor).getByText('Unavailable')).toBeInTheDocument()
    expect(within(cursor).getByText('Install the Cursor CLI.')).toBeInTheDocument()
    expect(within(cursor).getByRole('button', { name: 'Add' })).toBeDisabled()

    expect(screen.getByRole('group', { name: 'OpenCode' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Devin CLI' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/setup command/i)).not.toBeInTheDocument()
  })

  it('does not show client rows while the MCP server is stopped', async () => {
    mockMcp(mockInstallations(), { ...RUNNING_STATUS, state: 'stopped' })
    render(<McpSettingsSection onMessage={vi.fn()} open />)

    await waitFor(() => {
      expect(window.arkDesktop.mcp.getClientInstallations).toHaveBeenCalledOnce()
    })
    expect(screen.queryByRole('group', { name: 'Codex' })).not.toBeInTheDocument()
    expect(window.arkDesktop.mcp.addClient).not.toHaveBeenCalled()
  })

  it('adds a client through IPC and replaces that row from the returned installation', async () => {
    mockMcp()
    window.arkDesktop.mcp.addClient = vi.fn().mockResolvedValue({
      clientId: 'codex',
      status: 'installed',
    })
    const onMessage = vi.fn()
    render(<McpSettingsSection onMessage={onMessage} open />)

    const codex = await screen.findByRole('group', { name: 'Codex' })
    await userEvent.click(within(codex).getByRole('button', { name: 'Add' }))

    expect(window.arkDesktop.mcp.addClient).toHaveBeenCalledWith('codex')
    expect(await within(codex).findByText('Installed')).toBeInTheDocument()
    expect(within(codex).getByRole('button', { name: 'Remove' })).toBeEnabled()
    expect(onMessage).toHaveBeenCalledWith('Codex installed.')
  })

  it('removes and updates clients through the matching IPC methods', async () => {
    mockMcp()
    window.arkDesktop.mcp.removeClient = vi.fn().mockResolvedValue({
      clientId: 'claudeCode',
      status: 'notInstalled',
    })
    window.arkDesktop.mcp.updateClient = vi.fn().mockResolvedValue({
      clientId: 'grok',
      status: 'installed',
    })
    const onMessage = vi.fn()
    render(<McpSettingsSection onMessage={onMessage} open />)

    const claude = await screen.findByRole('group', { name: 'Claude Code' })
    await userEvent.click(within(claude).getByRole('button', { name: 'Remove' }))
    expect(window.arkDesktop.mcp.removeClient).toHaveBeenCalledWith('claudeCode')
    expect(await within(claude).findByText('Not installed')).toBeInTheDocument()
    expect(onMessage).toHaveBeenCalledWith('Claude Code removed.')

    const grok = screen.getByRole('group', { name: 'Grok' })
    await userEvent.click(within(grok).getByRole('button', { name: 'Update' }))
    expect(window.arkDesktop.mcp.updateClient).toHaveBeenCalledWith('grok')
    expect(await within(grok).findByText('Installed')).toBeInTheDocument()
    expect(onMessage).toHaveBeenCalledWith('Grok updated.')
  })

  it('disables the busy row while an action is in flight and reports failures', async () => {
    mockMcp()
    let resolveAdd!: (value: McpClientInstallation) => void
    window.arkDesktop.mcp.addClient = vi.fn(
      () =>
        new Promise<McpClientInstallation>((resolve) => {
          resolveAdd = resolve
        }),
    )
    window.arkDesktop.mcp.removeClient = vi.fn().mockRejectedValue(new Error('remove failed'))
    const onMessage = vi.fn()
    render(<McpSettingsSection onMessage={onMessage} open />)

    const codex = await screen.findByRole('group', { name: 'Codex' })
    const add = within(codex).getByRole('button', { name: 'Add' })
    const claudeRemove = within(screen.getByRole('group', { name: 'Claude Code' })).getByRole(
      'button',
      { name: 'Remove' },
    )
    await userEvent.click(add)
    expect(add).toBeDisabled()
    expect(claudeRemove).toBeEnabled()

    resolveAdd({ clientId: 'codex', status: 'installed' })
    expect(await within(codex).findByRole('button', { name: 'Remove' })).toBeEnabled()

    await userEvent.click(claudeRemove)
    await waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith('remove failed')
    })
  })
})

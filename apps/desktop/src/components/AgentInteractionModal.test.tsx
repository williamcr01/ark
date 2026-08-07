// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AgentInteractionModal } from '@/components/AgentInteractionModal'

vi.mock('@/components/MiniHtmlPreview', () => ({
  MiniHtmlPreview: ({ title }: { title: string }) => (
    <div data-testid="mini-html-preview">{title}</div>
  ),
}))

const mcpBase = {
  id: '00000000-0000-4000-8000-000000000001',
  deckId: '00000000-0000-4000-8000-000000000002',
  baseDocumentRevision: 1,
  clientName: 'Codex',
  createdAt: '2026-08-06T12:00:00.000Z',
  expiresAt: '2026-08-06T12:30:00.000Z',
} as const

const sampleHtml = '<!doctype html><html><body><section class="slide"></section></body></html>'

const themes = Array.from({ length: 4 }, (_, index) => ({
  id: `theme-${index}`,
  name: `Theme ${index}`,
  description: `Direction ${index}`,
  sampleHtml,
}))

describe('AgentInteractionModal', () => {
  it('does not render when there is no pending interaction', () => {
    render(<AgentInteractionModal />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('submits normal agent questions as a formatted answer', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(
      <AgentInteractionModal
        agentQuestions={{
          title: 'Shape the deck',
          questions: [
            {
              id: 'audience',
              question: 'Who is the audience?',
              type: 'single',
              options: ['Board', 'Customers'],
              required: true,
            },
          ],
        }}
        onAgentQuestionSubmit={onSubmit}
      />,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Board/ }))

    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining('Board'))
  })

  it('submits a normal agent theme choice', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(
      <AgentInteractionModal
        onAgentQuestionSubmit={onSubmit}
        themeProposal={{ title: 'Pick a direction', themes }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select Theme 2' }))
    await user.click(screen.getByRole('button', { name: 'Use this theme: Theme 2' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining('Theme 2 (id: theme-2)'))
  })

  it('submits MCP questions without a normal agent model', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(
      <AgentInteractionModal
        mcpInteraction={{
          ...mcpBase,
          kind: 'questions',
          request: {
            title: 'Shape the deck',
            questions: [
              {
                id: 'audience',
                question: 'Who is the audience?',
                type: 'single',
                options: ['Board', 'Customers'],
                required: true,
              },
            ],
          },
        }}
        onMcpInteractionSubmit={onSubmit}
      />,
    )

    expect(screen.getByText('Codex needs your input')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Customers/ }))

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'questions',
      answers: { audience: 'Customers' },
    })
  })

  it('submits MCP theme choices and can cancel the request', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const user = userEvent.setup()

    render(
      <AgentInteractionModal
        mcpInteraction={{
          ...mcpBase,
          kind: 'themes',
          request: { title: 'Pick a direction', themes },
        }}
        onMcpInteractionCancel={onCancel}
        onMcpInteractionSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select Theme 1' }))
    await user.click(screen.getByRole('button', { name: 'Use this theme: Theme 1' }))
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'themes', themeId: 'theme-1' })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

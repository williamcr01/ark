import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AgentPresence } from './AgentPresence'
import { getAgentPresenceState } from '@/lib/chat/agent-presence'

describe('AgentPresence', () => {
  it.each([
    ['queued', [], 'listening'],
    ['running', [{ type: 'thinking', summary: 'Reasoning' }], 'solving'],
    ['running', [{ type: 'tool-call', toolName: 'read_deck', summary: 'Reading' }], 'searching'],
    ['running', [{ type: 'tool-call', toolName: 'patch_deck', summary: 'Editing' }], 'shaping'],
    ['running', [{ type: 'text', summary: 'Writing' }], 'composing'],
    ['canceling', [{ type: 'tool-call', toolName: 'unknown', summary: 'Stopping' }], 'working'],
  ] as const)('maps %s work to %s', (status, steps, expected) => {
    expect(getAgentPresenceState([...steps], status)).toBe(expected)
  })

  it('renders nothing while idle and a static mark for reduced motion', () => {
    const { rerender } = render(
      <AgentPresence
        activeSteps={[]}
        generationStatus={null}
        reducedMotion
        resolvedAppearance="dark"
      />,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(
      <AgentPresence
        activeSteps={[]}
        generationStatus="queued"
        reducedMotion
        resolvedAppearance="dark"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Listening')
    expect(document.querySelector('canvas')).not.toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'

import { extractAgentSteps } from './deck-agent.ts'

describe('extractAgentSteps', () => {
  it('maps tool calls and results into chat-friendly steps', () => {
    const steps = extractAgentSteps([
      {
        text: 'Inspecting the deck.',
        toolCalls: [{ toolName: 'list_slides', input: {} }],
        toolResults: [
          {
            toolName: 'list_slides',
            output: { slideCount: 3, slides: [] },
          },
        ],
      },
      {
        text: '',
        toolCalls: [{ toolName: 'edit_deck', input: { edits: [{ oldText: 'a', newText: 'b' }] } }],
        toolResults: [
          {
            toolName: 'edit_deck',
            output: { ok: false, error: 'oldText was not found' },
          },
        ],
      },
    ])

    expect(steps).toEqual([
      { type: 'text', summary: 'Inspecting the deck.' },
      { type: 'tool-call', toolName: 'list_slides', summary: 'outline' },
      { type: 'tool-result', toolName: 'list_slides', summary: '3 slide(s)', error: false },
      { type: 'tool-call', toolName: 'edit_deck', summary: '1 patch(es)' },
      {
        type: 'tool-result',
        toolName: 'edit_deck',
        summary: 'oldText was not found',
        error: true,
      },
    ])
  })

  it('summarizes patch_deck tool activity', () => {
    const steps = extractAgentSteps([
      {
        text: '',
        toolCalls: [
          {
            toolName: 'patch_deck',
            input: {
              operations: [{ op: 'update_slide_title', slideIndex: 0, title: 'New title' }],
            },
          },
        ],
        toolResults: [
          {
            toolName: 'patch_deck',
            output: {
              ok: true,
              summary: 'Updated title on slide 0.',
              changedSlideIndexes: [0],
            },
          },
        ],
      },
    ])

    expect(steps).toEqual([
      { type: 'tool-call', toolName: 'patch_deck', summary: '1 op(s)' },
      {
        type: 'tool-result',
        toolName: 'patch_deck',
        summary: 'Updated title on slide 0.',
        error: false,
      },
    ])
  })
})

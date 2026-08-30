import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AgentQuestionRequest } from '@ark/chat/agent-questions.ts'
import { AgentQuestions } from '@/components/AgentQuestions'

const request: AgentQuestionRequest = {
  title: 'Before I start',
  questions: [
    {
      id: 'length',
      question: 'How long?',
      type: 'single',
      options: ['5 slides', '10 slides'],
      required: true,
    },
    {
      id: 'tone',
      question: 'Which tone?',
      type: 'single',
      options: ['Formal', 'Conversational'],
      required: false,
    },
    {
      id: 'notes',
      question: 'Anything else?',
      type: 'text',
      placeholder: 'Optional details',
      required: true,
    },
  ],
}

describe('AgentQuestions', () => {
  it('auto-advances on single choice and submits the final answers', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(<AgentQuestions onSubmit={onSubmit} request={request} />)

    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /5 slides/i }))

    expect(screen.getByText('Which tone?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Formal/i }))

    expect(screen.getByText('Anything else?')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox'), 'Keep it punchy')
    await user.click(screen.getByRole('button', { name: 'Send answers' }))

    expect(onSubmit).toHaveBeenCalledWith({
      length: '5 slides',
      tone: 'Formal',
      notes: 'Keep it punchy',
    })
  })

  it('merges write-your-own text with a selected single option', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(
      <AgentQuestions
        onSubmit={onSubmit}
        request={{
          title: 'Tone',
          questions: [
            {
              id: 'tone',
              question: 'Which tone?',
              type: 'single',
              options: ['Formal', 'Conversational'],
              required: true,
            },
          ],
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Write your own/i }))
    await user.type(screen.getByLabelText(/Write your own answer/i), 'Warm and direct')
    await user.click(screen.getByRole('button', { name: 'Send answers' }))

    expect(onSubmit).toHaveBeenCalledWith({ tone: 'Warm and direct' })
  })

  it('lets the user revisit an answered question from the trail', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(<AgentQuestions onSubmit={onSubmit} request={request} />)

    await user.click(screen.getByRole('button', { name: /5 slides/i }))
    expect(screen.getByText(/How long\?/)).toBeInTheDocument()
    expect(screen.getByText(/5 slides/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /How long\?/i }))
    expect(screen.getByText('How long?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /10 slides/i }))

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(onSubmit).toHaveBeenCalledWith({ length: '10 slides' })
  })

  it('skips any question including the last and submits with no answer', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(
      <AgentQuestions
        onSubmit={onSubmit}
        request={{
          title: 'One',
          questions: [
            {
              id: 'tone',
              question: 'Which tone?',
              type: 'single',
              options: ['Formal', 'Conversational'],
              required: true,
            },
          ],
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onSubmit).toHaveBeenCalledWith({})
  })
})

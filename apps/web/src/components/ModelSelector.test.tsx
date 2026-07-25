import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ModelSelector } from '@/components/ModelSelector'
import type { AvailableModel } from '@/hooks/useAvailableModels'

const models: AvailableModel[] = [
  {
    id: 'openai:gpt-5.6-luna',
    provider: 'openai',
    modelId: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    available: true,
    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
    supportsReasoning: true,
  },
  {
    id: 'openai:gpt-5.4-mini',
    provider: 'openai',
    modelId: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    available: true,
    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'none',
    supportsReasoning: true,
  },
  {
    id: 'openai:gpt-5.5',
    provider: 'openai',
    modelId: 'gpt-5.5',
    name: 'GPT-5.5',
    available: false,
    unavailableReason: 'missing_api_key',
    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
    supportsReasoning: true,
  },
  {
    id: 'anthropic:claude-sonnet-5',
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    available: false,
    unavailableReason: 'missing_api_key',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'high',
    supportsReasoning: true,
  },
  {
    id: 'google:gemini-3.5-flash',
    provider: 'google',
    modelId: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    available: true,
    reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    supportsReasoning: true,
  },
  {
    id: 'openai:text-only-fixture',
    provider: 'openai',
    modelId: 'text-only-fixture',
    name: 'Text Only Fixture',
    available: true,
    reasoningEfforts: [],
    supportsReasoning: false,
    supportsAttachments: false,
  },
]

describe('ModelSelector', () => {
  it('groups models by provider and selects effort after drilling into a model', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ModelSelector
        models={models}
        onSelect={onSelect}
        reasoningEffort="medium"
        value="openai:gpt-5.6-luna"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select model' }))

    expect(screen.getByText('OpenAI · 3 ready')).toBeInTheDocument()
    expect(screen.getByText('Anthropic · 0 ready')).toBeInTheDocument()
    expect(screen.getByText('Google · 1 ready')).toBeInTheDocument()
    expect(screen.getAllByText('No API key').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('menuitem', { name: /Gemini 3\.5 Flash/i }))

    const effortOption = await screen.findByRole('menuitem', { name: 'Medium' })
    await user.click(effortOption)

    expect(onSelect).toHaveBeenCalledWith('google:gemini-3.5-flash', 'medium')
  })

  it('does not select a model when activating the submenu trigger alone', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ModelSelector
        models={models}
        onSelect={onSelect}
        reasoningEffort="medium"
        value="openai:gpt-5.6-luna"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(screen.getByRole('menuitem', { name: /GPT-5\.6 Luna/i }))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('drills into effort with the keyboard', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ModelSelector
        models={models}
        onSelect={onSelect}
        reasoningEffort="medium"
        value="openai:gpt-5.6-luna"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select model' }))

    screen.getByRole('menuitem', { name: /GPT-5\.6 Luna/i }).focus()
    await user.keyboard('{Enter}')

    const effortOption = await screen.findByRole('menuitem', { name: 'Extra High' })
    await user.click(effortOption)

    expect(onSelect).toHaveBeenCalledWith('openai:gpt-5.6-luna', 'xhigh')
  })

  it('selects no-effort models directly', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ModelSelector
        models={models}
        onSelect={onSelect}
        reasoningEffort="medium"
        value="openai:gpt-5.6-luna"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(screen.getByText('Text Only Fixture'))

    expect(onSelect).toHaveBeenCalledWith('openai:text-only-fixture')
  })

  it('does not select unavailable models', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ModelSelector
        models={models}
        onSelect={onSelect}
        reasoningEffort="medium"
        value="openai:gpt-5.6-luna"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select model' }))

    const unavailable = screen.getByText('Claude Sonnet 5').closest('[data-disabled]')
    expect(unavailable).toBeTruthy()

    await user.click(screen.getByText('Claude Sonnet 5'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows loading placeholder and model · effort on the trigger', () => {
    const { rerender } = render(<ModelSelector isLoading models={[]} onSelect={vi.fn()} value="" />)

    expect(screen.getByRole('button', { name: 'Select model' })).toBeDisabled()

    rerender(
      <ModelSelector
        models={models}
        onSelect={vi.fn()}
        reasoningEffort="high"
        value="openai:gpt-5.6-luna"
      />,
    )

    expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent(
      'GPT-5.6 Luna · High',
    )
  })

  it('filters models via search', async () => {
    const user = userEvent.setup()

    render(
      <ModelSelector
        models={models}
        onSelect={vi.fn()}
        reasoningEffort="medium"
        value="openai:gpt-5.6-luna"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.type(screen.getByLabelText('Search models'), 'zzzz-no-match')

    expect(screen.getByText('No models match your search.')).toBeInTheDocument()
  })
})

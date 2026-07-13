import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ModelSelector } from '@/components/ModelSelector'
import type { AvailableModel } from '@/hooks/useAvailableModels'

const models: AvailableModel[] = [
  {
    id: 'openai:gpt-4o-mini',
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    available: true,
  },
  {
    id: 'openai:gpt-4o',
    provider: 'openai',
    modelId: 'gpt-4o',
    name: 'GPT-4o',
    available: false,
    unavailableReason: 'missing_api_key',
  },
  {
    id: 'anthropic:claude-sonnet-4-5',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    available: false,
    unavailableReason: 'missing_api_key',
  },
  {
    id: 'google:gemini-2.5-flash',
    provider: 'google',
    modelId: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    available: true,
  },
]

describe('ModelSelector', () => {
  it('groups models by provider and selects an available model', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ModelSelector models={models} onValueChange={onValueChange} value="openai:gpt-4o-mini" />,
    )

    await user.click(screen.getByRole('button', { name: 'Select model' }))

    expect(screen.getByText('OpenAI · 1 ready')).toBeInTheDocument()
    expect(screen.getByText('Anthropic · 0 ready')).toBeInTheDocument()
    expect(screen.getByText('Google · 1 ready')).toBeInTheDocument()
    expect(screen.getAllByText('No API key').length).toBeGreaterThan(0)

    await user.click(screen.getByText('Gemini 2.5 Flash'))

    expect(onValueChange).toHaveBeenCalledWith('google:gemini-2.5-flash')
  })

  it('does not select unavailable models', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ModelSelector models={models} onValueChange={onValueChange} value="openai:gpt-4o-mini" />,
    )

    await user.click(screen.getByRole('button', { name: 'Select model' }))

    const unavailable = screen.getByText('Claude Sonnet 4.5').closest('[data-slot="command-item"]')
    expect(unavailable).toHaveAttribute('data-disabled', 'true')

    await user.click(screen.getByText('Claude Sonnet 4.5'))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('shows a loading placeholder and disables the trigger', () => {
    render(<ModelSelector isLoading models={[]} onValueChange={vi.fn()} value="" />)

    expect(screen.getByRole('button', { name: 'Select model' })).toBeDisabled()
  })

  it('filters models via search', async () => {
    const user = userEvent.setup()

    render(<ModelSelector models={models} onValueChange={vi.fn()} value="openai:gpt-4o-mini" />)

    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.type(screen.getByPlaceholderText('Search models…'), 'zzzz-no-match')

    expect(screen.getByText('No models match your search.')).toBeInTheDocument()
  })
})

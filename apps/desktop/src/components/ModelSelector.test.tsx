import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    supportsAttachments: true,
  },
  {
    id: 'openai:gpt-5.4-mini',
    provider: 'openai',
    modelId: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    available: true,
    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'none',
    supportsAttachments: true,
  },
  {
    id: 'google:gemini-3.5-flash',
    provider: 'google',
    modelId: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    available: true,
    reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    supportsAttachments: true,
  },
  {
    id: 'openrouter:anthropic/claude-3.5-sonnet',
    provider: 'openrouter',
    modelId: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    available: true,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    supportsAttachments: true,
  },
  {
    id: 'openrouter:meta-llama/llama-3.1-8b-instruct',
    provider: 'openrouter',
    modelId: 'meta-llama/llama-3.1-8b-instruct',
    available: true,
    supportsAttachments: false,
  },
  {
    id: 'openai:text-only-fixture',
    provider: 'openai',
    modelId: 'text-only-fixture',
    name: 'Text Only Fixture',
    available: true,
    reasoningEfforts: [],
    supportsAttachments: false,
  },
]

describe('ModelSelector', () => {
  it('shows remembered effort and selects a model with it', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ModelSelector
        getReasoningEffort={(modelId) =>
          modelId === 'google:gemini-3.5-flash' ? 'high' : undefined
        }
        models={models}
        onSelect={onSelect}
        reasoningEffort="medium"
        value="openai:gpt-5.6-luna"
      />,
    )

    expect(document.querySelectorAll('[data-provider-logo="openai"]')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Select model' }))

    const menu = screen.getByRole('menu')
    expect(menu.querySelectorAll('[data-provider-logo="openai"]')).toHaveLength(1)
    expect(menu.querySelectorAll('[data-provider-logo="google"]')).toHaveLength(1)
    expect(screen.getByText('OpenAI · 3 ready')).toBeInTheDocument()
    expect(screen.getByText('Google · 1 ready')).toBeInTheDocument()
    expect(screen.getByText('OpenRouter · 2 ready')).toBeInTheDocument()
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument()
    expect(screen.getByText('meta-llama/llama-3.1-8b-instruct')).toBeInTheDocument()
    expect(screen.queryByText('No API key')).not.toBeInTheDocument()
    expect(screen.queryByText(/missing_api_key/)).not.toBeInTheDocument()
    expect(screen.queryByText('Anthropic · 0 ready')).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /Gemini 3\.5 Flash\s*High/i }))

    expect(onSelect).toHaveBeenCalledWith('google:gemini-3.5-flash', 'high')
  })

  it('opens the effort editor without selecting the model', async () => {
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
    await user.click(
      screen.getByRole('menuitem', { name: 'Edit thinking effort for GPT-5.6 Luna' }),
    )

    expect(screen.getByText('Thinking effort')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps the effort wing mounted for its close animation', async () => {
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
    const edit = screen.getByRole('menuitem', {
      name: 'Edit thinking effort for GPT-5.6 Luna',
    })
    await user.click(edit)
    await user.click(edit)

    const wing = screen.getByText('Thinking effort').parentElement
    expect(wing).toHaveAttribute('data-state', 'closed')

    fireEvent.animationEnd(wing!)
    await waitFor(() => {
      expect(screen.queryByText('Thinking effort')).not.toBeInTheDocument()
    })
  })

  it('closes the current effort wing before opening another one', async () => {
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
    await user.click(
      screen.getByRole('menuitem', { name: 'Edit thinking effort for GPT-5.6 Luna' }),
    )
    await user.click(
      screen.getByRole('menuitem', { name: 'Edit thinking effort for GPT-5.4 Mini' }),
    )

    const oldWing = screen.getByText('Thinking effort').parentElement
    expect(oldWing).toHaveAttribute('data-model-id', 'openai:gpt-5.6-luna')
    expect(oldWing).toHaveAttribute('data-state', 'closed')

    fireEvent.animationEnd(oldWing!)

    await waitFor(() => {
      const newWing = screen.getByText('Thinking effort').parentElement
      expect(newWing).toHaveAttribute('data-model-id', 'openai:gpt-5.4-mini')
      expect(newWing).toHaveAttribute('data-state', 'open')
    })
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

    screen.getByRole('menuitem', { name: 'Edit thinking effort for GPT-5.6 Luna' }).focus()
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

  it('does not render missing_api_key ghost rows', async () => {
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

    expect(screen.queryByText('No API key')).not.toBeInTheDocument()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0)
  })

  it('disables the picker and shows an empty state when the catalog has no models', () => {
    render(<ModelSelector models={[]} onSelect={vi.fn()} value="" />)

    const trigger = screen.getByRole('button', { name: 'Select model' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveTextContent('Add an API key in Settings')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
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

    const trigger = screen.getByRole('button', { name: 'Select model' })
    expect(trigger).toHaveTextContent('GPT-5.6 Luna · High')
    expect(trigger).toHaveAttribute('title', 'GPT-5.6 Luna · High')
  })

  it('hides thinking effort on the trigger when the full label cannot fit', () => {
    let observedCallback: ResizeObserverCallback | null = null
    class MeasuringResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      constructor(callback: ResizeObserverCallback) {
        observedCallback = callback
      }
    }

    const previous = globalThis.ResizeObserver
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: MeasuringResizeObserver,
    })

    const fireResize = (label: HTMLElement) => {
      act(() => {
        observedCallback?.(
          [
            {
              borderBoxSize: [],
              contentBoxSize: [],
              contentRect: label.getBoundingClientRect(),
              devicePixelContentBoxSize: [],
              target: label,
            },
          ],
          new MeasuringResizeObserver(() => undefined) as unknown as ResizeObserver,
        )
      })
    }

    try {
      render(
        <ModelSelector
          models={models}
          onSelect={vi.fn()}
          reasoningEffort="xhigh"
          value="openai:gpt-5.6-luna"
        />,
      )

      const trigger = screen.getByRole('button', { name: 'Select model' })
      const label = trigger.querySelector('span.relative') as HTMLSpanElement
      const measure = label.querySelector('[aria-hidden="true"]') as HTMLSpanElement

      Object.defineProperty(label, 'clientWidth', { configurable: true, value: 72 })
      Object.defineProperty(measure, 'scrollWidth', { configurable: true, value: 180 })
      fireResize(label)

      const visibleLabel = label.querySelector('span.flex')
      expect(visibleLabel).toHaveTextContent('GPT-5.6 Luna')
      expect(visibleLabel).not.toHaveTextContent('Extra High')
      expect(trigger).toHaveAttribute('title', 'GPT-5.6 Luna · Extra High')

      // Wider chat panel: grow reclaiming space should restore the effort suffix.
      Object.defineProperty(label, 'clientWidth', { configurable: true, value: 220 })
      fireResize(label)

      expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent('Extra High')
    } finally {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: previous,
      })
    }
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

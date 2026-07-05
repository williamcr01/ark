import { generateText, stepCountIs, type LanguageModel } from 'ai'

import { buildAgentModelMessages, type AgentStep, type ApiChatMessage } from '../shared/chat.ts'
import { buildRuntimeRegistryPromptSection } from '../shared/deck-runtime-registry.ts'
import { createDeckTools } from './deck-tools.ts'
import { createDeckWorkspace } from './deck-workspace.ts'
import { extractHtmlDocument, finalizeGeneratedDeck } from './generate-response.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'

export const AGENT_MAX_STEPS = 12

export const deckAgentSystemPrompt = `You are Ark, an expert presentation designer and front-end engineer.

You edit slide decks as a single self-contained HTML document using the provided tools.

Tool workflow:
- **New deck**: call write_deck with a complete HTML document.
- **Edit existing deck**: call parse_deck, list_slides, and/or read_deck first, then edit_deck with exact oldText/newText patches.
- **Prefer edit_deck** for follow-up changes. Use write_deck only for brand-new decks or explicit full rewrites.
- After edits, you may read_deck again to verify structure before replying.

Hard requirements for deck HTML:
- Include <!DOCTYPE html>, <html>, <head>, and <body>.
- Use inline CSS inside a <style> tag. No Tailwind, npm packages, or build tooling.
- Decks must be fully self-contained: no http(s) URLs for scripts, stylesheets, fonts, or images.
- Use inline CSS, system fonts, inline SVG, or data: URIs instead of external assets.
- Design for 16:9: html/body width 100%, height 100%, margin 0, overflow hidden; active slide fills 100vw × 100vh.
- Each slide is a top-level <section class="slide">. All slides in the DOM at once.
- Keep copy concise and presentation-grade. Avoid lorem ipsum and generic filler.

Preview modes:
- Default: no marker — Ark injects navigation; scripts may be stripped.
- Full-JS: set data-ark-deck="nav" on <html> when the deck owns navigation.
- When using data-ark-deck="nav", follow the Ark deck bridge protocol in docs/deck-bridge.md.
- Listen for CustomEvent "ark:deck-goto" with detail.index from the Ark bridge.
- Dispatch CustomEvent "ark:deck-slide-change" with detail.index on every slide change. Do not call window.parent.postMessage.
- External JavaScript libraries are only acceptable if inlined or bundled in the HTML; never use external script URLs.

Approved runtime libraries (Ark-served only — use exact pinned URLs, never CDNs):
${buildRuntimeRegistryPromptSection()}

When you finish, reply briefly in plain language summarizing what changed. Do not paste the full HTML in your final message — the tools already updated the deck.`

export type RunDeckAgentOptions = {
  model: LanguageModel
  messages: ApiChatMessage[]
  currentHtml: string
  abortSignal?: AbortSignal
  onStepProgress?: (steps: AgentStep[]) => void | Promise<void>
}

export type RunDeckAgentResult =
  | {
      ok: true
      html: string
      validation: ReturnType<typeof validateDeckHtmlOnServer>
      steps: AgentStep[]
      assistantText: string
    }
  | {
      ok: false
      error: string
      steps: AgentStep[]
      validation?: ReturnType<typeof validateDeckHtmlOnServer>
    }

function summarizeToolInput(toolName: string, input: unknown) {
  if (!input || typeof input !== 'object') {
    return ''
  }

  const record = input as Record<string, unknown>

  switch (toolName) {
    case 'read_deck': {
      if (typeof record.slideIndex === 'number') {
        return `slide ${record.slideIndex}`
      }

      const offset = typeof record.offset === 'number' ? record.offset : 1
      const limit = typeof record.limit === 'number' ? record.limit : 'default'
      return `lines ${offset}–${limit}`
    }
    case 'edit_deck':
      return `${Array.isArray(record.edits) ? record.edits.length : 0} patch(es)`
    case 'write_deck':
      return 'full deck'
    case 'list_slides':
    case 'parse_deck':
      return 'outline'
    default:
      return ''
  }
}

function summarizeToolOutput(toolName: string, output: unknown) {
  if (!output || typeof output !== 'object') {
    return 'Done'
  }

  const record = output as Record<string, unknown>

  if (typeof record.error === 'string') {
    return record.error
  }

  if (typeof record.message === 'string') {
    return record.message
  }

  switch (toolName) {
    case 'list_slides':
    case 'parse_deck':
      return `${typeof record.slideCount === 'number' ? record.slideCount : 0} slide(s)`
    case 'read_deck':
      if (record.mode === 'slide' && typeof record.title === 'string') {
        return record.title
      }
      return `${typeof record.totalLines === 'number' ? record.totalLines : '?'} lines`
    case 'edit_deck':
      return typeof record.appliedCount === 'number'
        ? `Applied ${record.appliedCount} edit(s)`
        : 'Edit complete'
    case 'write_deck':
      return typeof record.slideCount === 'number'
        ? `${record.slideCount} slide(s) written`
        : 'Deck written'
    default:
      return 'Done'
  }
}

export function extractAgentSteps(
  steps: Array<{
    text: string
    toolCalls: Array<{ toolName: string; input: unknown }>
    toolResults: Array<{ toolName: string; output: unknown }>
  }>,
): AgentStep[] {
  const events: AgentStep[] = []

  for (const step of steps) {
    if (step.text.trim()) {
      events.push({ type: 'text', summary: step.text.trim() })
    }

    for (const toolCall of step.toolCalls) {
      events.push({
        type: 'tool-call',
        toolName: toolCall.toolName,
        summary: summarizeToolInput(toolCall.toolName, toolCall.input),
      })
    }

    for (const toolResult of step.toolResults) {
      const summary = summarizeToolOutput(toolResult.toolName, toolResult.output)
      const isError =
        !!toolResult.output &&
        typeof toolResult.output === 'object' &&
        ('error' in toolResult.output ||
          ('ok' in toolResult.output && toolResult.output.ok === false))

      events.push({
        type: 'tool-result',
        toolName: toolResult.toolName,
        summary,
        error: isError,
      })
    }
  }

  return events
}

function throwIfAborted(abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) {
    throw new DOMException('Generation canceled.', 'AbortError')
  }
}

export async function runDeckAgent({
  model,
  messages,
  currentHtml,
  abortSignal,
  onStepProgress,
}: RunDeckAgentOptions): Promise<RunDeckAgentResult> {
  throwIfAborted(abortSignal)

  const workspace = createDeckWorkspace(currentHtml)
  const tools = createDeckTools(workspace)
  const accumulatedSteps: AgentStep[] = []

  const result = await generateText({
    model,
    system: deckAgentSystemPrompt,
    messages: buildAgentModelMessages(messages, currentHtml),
    tools,
    stopWhen: stepCountIs(AGENT_MAX_STEPS),
    maxOutputTokens: 8_000,
    temperature: 0.4,
    abortSignal,
    onStepFinish: async (step) => {
      throwIfAborted(abortSignal)
      accumulatedSteps.push(...extractAgentSteps([step]))
      await onStepProgress?.(accumulatedSteps)
    },
  })

  throwIfAborted(abortSignal)

  const steps = accumulatedSteps.length > 0 ? accumulatedSteps : extractAgentSteps(result.steps)

  if (workspace.changed && workspace.html.trim()) {
    const validation = validateDeckHtmlOnServer(workspace.html)

    if (!validation.valid) {
      const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')

      return {
        ok: false,
        error:
          primaryIssue?.message ??
          'The agent produced an invalid deck. Try a more specific edit request.',
        steps,
        validation,
      }
    }

    return {
      ok: true,
      html: workspace.html,
      validation,
      steps,
      assistantText: result.text.trim(),
    }
  }

  const fallback = finalizeGeneratedDeck(result.text)

  if (fallback.ok) {
    return {
      ok: true,
      html: fallback.html,
      validation: fallback.validation,
      steps,
      assistantText: result.text.trim(),
    }
  }

  const extracted = extractHtmlDocument(result.text)

  if (extracted !== result.text.trim() && extracted.includes('<html')) {
    const extractedFinal = finalizeGeneratedDeck(extracted)

    if (extractedFinal.ok) {
      return {
        ok: true,
        html: extractedFinal.html,
        validation: extractedFinal.validation,
        steps,
        assistantText: result.text.trim(),
      }
    }
  }

  return {
    ok: false,
    error:
      fallback.error ??
      'The agent did not update the deck. Ask for a specific change or try again.',
    steps,
    validation: fallback.validation,
  }
}

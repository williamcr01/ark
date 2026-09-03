import { PencilIcon } from 'lucide-react'

import type { AgentQuestion } from '@ark/chat/agent-questions.ts'

import {
  formatAgentQuestionTrailAnswer,
  type AgentQuestionStepRecord,
} from './agent-questions-model.ts'

export function AgentQuestionsTrail({
  disabled,
  onJump,
  trail,
}: {
  disabled: boolean
  onJump: (index: number) => void
  trail: Array<{ question: AgentQuestion; record: AgentQuestionStepRecord; index: number }>
}) {
  return (
    <ul className="flex flex-col gap-1.5 border-b border-border/60 pb-3">
      {trail.map(({ question: item, record, index }) => (
        <li key={item.id}>
          <button
            className="text-muted-foreground hover:text-foreground flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left text-xs transition-colors"
            disabled={disabled}
            onClick={() => onJump(index)}
            type="button"
          >
            <PencilIcon aria-hidden className="mt-0.5 size-3 shrink-0 opacity-60" />
            <span className="min-w-0">
              <span className="text-foreground/80">{item.question}</span>
              <span className="text-muted-foreground">
                : {formatAgentQuestionTrailAnswer(item, record)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

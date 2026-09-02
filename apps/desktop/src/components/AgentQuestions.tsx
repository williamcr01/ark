import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { MessageCircleQuestionIcon } from 'lucide-react'

import type { AgentQuestionAnswers, AgentQuestionRequest } from '@ark/chat/agent-questions.ts'

import { AgentQuestionStep } from './AgentQuestionStep.tsx'
import { AgentQuestionsTrail } from './AgentQuestionsTrail.tsx'
import { handleAgentQuestionsPanelKeyDown, useAgentQuestionsFlow } from './useAgentQuestionsFlow.ts'

export function AgentQuestions({
  request,
  submitLabel = 'Send answers',
  disabled = false,
  onSubmit,
}: {
  request: AgentQuestionRequest
  submitLabel?: string
  disabled?: boolean
  onSubmit: (answers: AgentQuestionAnswers) => void
}) {
  const baseId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const questions = request.questions
  const flow = useAgentQuestionsFlow(questions, disabled, onSubmit)
  const question = flow.question
  const isLast = flow.stepIndex >= questions.length - 1
  const advanceLabel = isLast ? submitLabel : 'Continue'

  useEffect(() => {
    if (!question || flow.drafts.writingCustom || question.type === 'text') return
    panelRef.current?.focus()
  }, [flow.drafts.writingCustom, flow.stepIndex, question])

  if (!question) return null

  const answeredTrail = questions
    .slice(0, flow.stepIndex)
    .map((item, index) => {
      const record = flow.records[item.id]
      if (!record) return null
      return { question: item, record, index }
    })
    .filter(Boolean) as Array<{
    question: (typeof questions)[number]
    record: (typeof flow.records)[string]
    index: number
  }>

  const canContinueMultiple =
    flow.drafts.multiple.length > 0 ||
    (flow.drafts.writingCustom && Boolean(flow.drafts.custom.trim()))
  const onTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      flow.handlers.continueText()
    }
  }

  return (
    <div
      className="mb-3 flex flex-col gap-3 px-1 outline-none"
      data-slot="agent-questions"
      onKeyDown={(event) =>
        handleAgentQuestionsPanelKeyDown(event, {
          disabled,
          writingCustom: flow.drafts.writingCustom,
          question,
          records: flow.records,
          setWritingCustom: flow.setters.writingCustom,
          setCustomDraft: flow.setters.custom,
          toggleMultiple: flow.handlers.toggleMultiple,
          recordAnswer: flow.handlers.recordAnswer,
        })
      }
      ref={panelRef}
      role="group"
      tabIndex={-1}
    >
      <div className="flex items-start gap-2">
        <MessageCircleQuestionIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{request.title}</p>
            {questions.length > 1 ? (
              <p className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {flow.stepIndex + 1} of {questions.length}
              </p>
            ) : null}
          </div>
          {request.description ? (
            <p className="text-muted-foreground text-xs">{request.description}</p>
          ) : null}
        </div>
      </div>

      {answeredTrail.length > 0 ? (
        <AgentQuestionsTrail disabled={disabled} onJump={flow.goToStep} trail={answeredTrail} />
      ) : null}

      <AgentQuestionStep
        advanceLabel={advanceLabel}
        baseId={baseId}
        canConfirmCustom={Boolean(flow.drafts.custom.trim())}
        canContinueMultiple={canContinueMultiple}
        canContinueText={Boolean(flow.drafts.text.trim())}
        customDraft={flow.drafts.custom}
        disabled={disabled}
        key={question.id}
        multipleDraftSet={new Set(flow.drafts.multiple)}
        onConfirmCustom={flow.handlers.confirmCustom}
        onContinueMultiple={flow.handlers.continueMultiple}
        onContinueText={flow.handlers.continueText}
        onSelectSingle={(option) => flow.handlers.recordAnswer(option)}
        onSkip={flow.handlers.skip}
        onTextKeyDown={onTextKeyDown}
        onToggleMultiple={flow.handlers.toggleMultiple}
        question={question}
        records={flow.records}
        setCustomDraft={flow.setters.custom}
        setTextDraft={flow.setters.text}
        setWritingCustom={flow.setters.writingCustom}
        textDraft={flow.drafts.text}
        writingCustom={flow.drafts.writingCustom}
      />
    </div>
  )
}

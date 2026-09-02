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
    if (!question || flow.writingCustom || question.type === 'text') return
    panelRef.current?.focus()
  }, [flow.writingCustom, flow.stepIndex, question])

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
    flow.multipleDraft.length > 0 || (flow.writingCustom && Boolean(flow.customDraft.trim()))
  const onTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      flow.handleContinueText()
    }
  }

  return (
    <div
      className="mb-3 flex flex-col gap-3 px-1 outline-none"
      data-slot="agent-questions"
      onKeyDown={(event) =>
        handleAgentQuestionsPanelKeyDown(event, {
          disabled,
          writingCustom: flow.writingCustom,
          question,
          records: flow.records,
          setWritingCustom: flow.setWritingCustom,
          setCustomDraft: flow.setCustomDraft,
          toggleMultiple: flow.toggleMultiple,
          recordAnswer: flow.recordAnswer,
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
        canConfirmCustom={Boolean(flow.customDraft.trim())}
        canContinueMultiple={canContinueMultiple}
        canContinueText={Boolean(flow.textDraft.trim())}
        customDraft={flow.customDraft}
        disabled={disabled}
        key={question.id}
        multipleDraftSet={new Set(flow.multipleDraft)}
        onConfirmCustom={flow.handleConfirmCustom}
        onContinueMultiple={flow.handleContinueMultiple}
        onContinueText={flow.handleContinueText}
        onSelectSingle={(option) => flow.recordAnswer(option)}
        onSkip={flow.handleSkip}
        onTextKeyDown={onTextKeyDown}
        onToggleMultiple={flow.toggleMultiple}
        question={question}
        records={flow.records}
        setCustomDraft={flow.setCustomDraft}
        setTextDraft={flow.setTextDraft}
        setWritingCustom={flow.setWritingCustom}
        textDraft={flow.textDraft}
        writingCustom={flow.writingCustom}
      />
    </div>
  )
}

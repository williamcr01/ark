import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { AgentQuestion } from '@ark/chat/agent-questions.ts'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { AgentQuestionOptionRow } from './AgentQuestionOptionRow.tsx'
import type { AgentQuestionStepRecord } from './agent-questions-model.ts'

export type AgentQuestionStepProps = {
  advanceLabel: string
  baseId: string
  canConfirmCustom: boolean
  canContinueMultiple: boolean
  canContinueText: boolean
  customDraft: string
  disabled: boolean
  multipleDraftSet: Set<string>
  onConfirmCustom: () => void
  onContinueMultiple: () => void
  onContinueText: () => void
  onSelectSingle: (option: string) => void
  onSkip: () => void
  onTextKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onToggleMultiple: (option: string) => void
  question: AgentQuestion
  records: Record<string, AgentQuestionStepRecord>
  setCustomDraft: (value: string) => void
  setTextDraft: (value: string) => void
  setWritingCustom: (value: boolean) => void
  textDraft: string
  writingCustom: boolean
}

function AgentQuestionStepChoices({
  baseId,
  question,
  disabled,
  multipleDraftSet,
  writingCustom,
  records,
  customDraft,
  canConfirmCustom,
  advanceLabel,
  onToggleMultiple,
  onSelectSingle,
  onConfirmCustom,
  setCustomDraft,
  setWritingCustom,
}: Pick<
  AgentQuestionStepProps,
  | 'baseId'
  | 'question'
  | 'disabled'
  | 'multipleDraftSet'
  | 'writingCustom'
  | 'records'
  | 'customDraft'
  | 'canConfirmCustom'
  | 'advanceLabel'
  | 'onToggleMultiple'
  | 'onSelectSingle'
  | 'onConfirmCustom'
  | 'setCustomDraft'
  | 'setWritingCustom'
>) {
  return (
    <div aria-labelledby={`${baseId}-question`} className="flex flex-col gap-1.5" role="group">
      {question.options?.map((option, optionIndex) => {
        const selected =
          question.type === 'multiple'
            ? multipleDraftSet.has(option)
            : !writingCustom && records[question.id]?.answer === option
        return (
          <AgentQuestionOptionRow
            disabled={disabled}
            hint={optionIndex < 9 ? String(optionIndex + 1) : undefined}
            key={option}
            multi={question.type === 'multiple'}
            onClick={() => {
              if (question.type === 'multiple') {
                setWritingCustom(false)
                onToggleMultiple(option)
              } else {
                onSelectSingle(option)
              }
            }}
            selected={Boolean(selected)}
          >
            {option}
          </AgentQuestionOptionRow>
        )
      })}

      {writingCustom ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-background/40 p-3">
          <Textarea
            aria-label={`Write your own answer for ${question.question}`}
            autoFocus
            disabled={disabled}
            onChange={(event) => setCustomDraft(event.currentTarget.value)}
            placeholder={question.placeholder ?? 'Write your own answer…'}
            rows={2}
            value={customDraft}
          />
          {question.type === 'single' ? (
            <div className="flex justify-end">
              <Button
                disabled={disabled || !canConfirmCustom}
                onClick={onConfirmCustom}
                size="sm"
                type="button"
              >
                {advanceLabel}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <AgentQuestionOptionRow
          disabled={disabled}
          onClick={() => {
            setWritingCustom(true)
            setCustomDraft(records[question.id]?.written ?? '')
          }}
          selected={false}
        >
          Write your own…
        </AgentQuestionOptionRow>
      )}
    </div>
  )
}

export function AgentQuestionStep(props: AgentQuestionStepProps) {
  const {
    advanceLabel,
    baseId,
    canContinueMultiple,
    canContinueText,
    disabled,
    onContinueMultiple,
    onContinueText,
    onSkip,
    onTextKeyDown,
    question,
    setTextDraft,
    textDraft,
  } = props

  return (
    <div className="animate-[enter_0.2s_ease-out] fade-in slide-in-from-bottom-2 flex flex-col gap-3">
      <p className="text-sm font-medium" id={`${baseId}-question`}>
        {question.question}
      </p>

      {question.type === 'text' ? (
        <Textarea
          aria-labelledby={`${baseId}-question`}
          autoFocus
          disabled={disabled}
          onChange={(event) => setTextDraft(event.currentTarget.value)}
          onKeyDown={onTextKeyDown}
          placeholder={question.placeholder}
          rows={2}
          value={textDraft}
        />
      ) : (
        <AgentQuestionStepChoices {...props} />
      )}

      <div className="flex items-center justify-between gap-2">
        <Button disabled={disabled} onClick={onSkip} size="sm" type="button" variant="ghost">
          Skip
        </Button>
        {question.type === 'text' ? (
          <Button
            disabled={disabled || !canContinueText}
            onClick={onContinueText}
            size="sm"
            type="button"
          >
            {advanceLabel}
          </Button>
        ) : null}
        {question.type === 'multiple' ? (
          <Button
            disabled={disabled || !canContinueMultiple}
            onClick={onContinueMultiple}
            size="sm"
            type="button"
          >
            {advanceLabel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

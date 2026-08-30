import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { CheckIcon, MessageCircleQuestionIcon, PencilIcon } from 'lucide-react'

import type {
  AgentQuestion,
  AgentQuestionAnswers,
  AgentQuestionRequest,
} from '@ark/chat/agent-questions.ts'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/ui/utils'

type StepRecord = {
  status: 'answered' | 'skipped'
  answer?: string | string[]
  written?: string
}

function formatTrailAnswer(question: AgentQuestion, record: StepRecord) {
  if (record.status === 'skipped') return 'Skipped'
  const answer = record.answer
  const written = record.written?.trim()
  if (question.type === 'text') return (typeof answer === 'string' ? answer : '') || 'No answer'
  if (Array.isArray(answer)) {
    const parts = [...answer]
    if (written) parts.push(written)
    return parts.join(', ') || 'No answer'
  }
  if (answer && written) return `${answer}: ${written}`
  return answer || written || 'No answer'
}

function combineAnswers(
  questions: AgentQuestion[],
  records: Record<string, StepRecord>,
): AgentQuestionAnswers {
  const answers: AgentQuestionAnswers = {}
  for (const question of questions) {
    const record = records[question.id]
    if (!record || record.status === 'skipped') continue

    if (question.type === 'text') {
      const value = typeof record.answer === 'string' ? record.answer.trim() : ''
      if (value) answers[question.id] = value
      continue
    }

    const written = record.written?.trim()
    const selected = record.answer
    if (question.type === 'multiple') {
      const list = Array.isArray(selected) ? [...selected] : []
      if (written) list.push(written)
      if (list.length > 0) answers[question.id] = list
      continue
    }

    if (selected && written) {
      answers[question.id] = `${selected}: ${written}`
    } else if (typeof selected === 'string' && selected) {
      answers[question.id] = selected
    } else if (written) {
      answers[question.id] = written
    }
  }
  return answers
}

function OptionRow({
  selected,
  multi,
  hint,
  disabled,
  children,
  onClick,
}: {
  selected: boolean
  multi?: boolean
  hint?: string
  disabled?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
        'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected ? 'border-foreground/25 bg-muted/80' : 'border-border/80 bg-background/40',
        disabled && 'pointer-events-none opacity-50',
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center border',
          multi ? 'rounded-[4px]' : 'rounded-full',
          selected
            ? 'border-foreground bg-foreground text-background'
            : 'border-muted-foreground/40',
        )}
      >
        {selected ? <CheckIcon className="size-2.5" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1 whitespace-normal">{children}</span>
      {hint ? (
        <kbd className="text-muted-foreground mt-0.5 shrink-0 font-mono text-[10px]">{hint}</kbd>
      ) : null}
    </button>
  )
}

function AnsweredTrail({
  disabled,
  onJump,
  trail,
}: {
  disabled: boolean
  onJump: (index: number) => void
  trail: Array<{ question: AgentQuestion; record: StepRecord; index: number }>
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
              <span className="text-muted-foreground">: {formatTrailAnswer(item, record)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function QuestionStep({
  advanceLabel,
  baseId,
  canConfirmCustom,
  canContinueMultiple,
  canContinueText,
  customDraft,
  disabled,
  multipleDraftSet,
  onConfirmCustom,
  onContinueMultiple,
  onContinueText,
  onSelectSingle,
  onSkip,
  onTextKeyDown,
  onToggleMultiple,
  question,
  records,
  setCustomDraft,
  setTextDraft,
  setWritingCustom,
  textDraft,
  writingCustom,
}: {
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
  records: Record<string, StepRecord>
  setCustomDraft: (value: string) => void
  setTextDraft: (value: string) => void
  setWritingCustom: (value: boolean) => void
  textDraft: string
  writingCustom: boolean
}) {
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
        <div aria-labelledby={`${baseId}-question`} className="flex flex-col gap-1.5" role="group">
          {question.options?.map((option, optionIndex) => {
            const selected =
              question.type === 'multiple'
                ? multipleDraftSet.has(option)
                : !writingCustom && records[question.id]?.answer === option
            return (
              <OptionRow
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
              </OptionRow>
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
            <OptionRow
              disabled={disabled}
              onClick={() => {
                setWritingCustom(true)
                setCustomDraft(records[question.id]?.written ?? '')
              }}
              selected={false}
            >
              Write your own…
            </OptionRow>
          )}
        </div>
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
  const [stepIndex, setStepIndex] = useState(0)
  const [records, setRecords] = useState<Record<string, StepRecord>>({})
  const [writingCustom, setWritingCustom] = useState(false)
  const [customDraft, setCustomDraft] = useState('')
  const [textDraft, setTextDraft] = useState('')
  const [multipleDraft, setMultipleDraft] = useState<string[]>([])

  const question = questions[stepIndex]
  const isLast = stepIndex >= questions.length - 1
  const advanceLabel = isLast ? submitLabel : 'Continue'

  const hydrateStep = (index: number, nextRecords: Record<string, StepRecord>) => {
    const next = questions[index]
    if (!next) return
    const record = nextRecords[next.id]
    setWritingCustom(Boolean(record?.written))
    setCustomDraft(record?.written ?? '')
    if (next.type === 'text') {
      setTextDraft(typeof record?.answer === 'string' ? record.answer : '')
      setMultipleDraft([])
    } else if (next.type === 'multiple') {
      setMultipleDraft(Array.isArray(record?.answer) ? record.answer : [])
      setTextDraft('')
    } else {
      setTextDraft('')
      setMultipleDraft([])
    }
  }

  const goToStep = (index: number) => {
    setStepIndex(index)
    hydrateStep(index, records)
  }

  const finishOrAdvance = (nextRecords: Record<string, StepRecord>, fromIndex: number) => {
    if (fromIndex >= questions.length - 1) {
      onSubmit(combineAnswers(questions, nextRecords))
      return
    }
    const nextIndex = fromIndex + 1
    setStepIndex(nextIndex)
    hydrateStep(nextIndex, nextRecords)
  }

  const recordAnswer = (
    answer: string | string[] | undefined,
    written?: string,
    status: StepRecord['status'] = 'answered',
  ) => {
    if (!question || disabled) return
    const nextRecords = {
      ...records,
      [question.id]: {
        status,
        ...(status === 'answered'
          ? {
              ...(answer !== undefined ? { answer } : {}),
              ...(written?.trim() ? { written: written.trim() } : {}),
            }
          : {}),
      },
    }
    setRecords(nextRecords)
    finishOrAdvance(nextRecords, stepIndex)
  }

  const handleSkip = () => {
    recordAnswer(undefined, undefined, 'skipped')
  }

  const handleSingleSelect = (option: string) => {
    recordAnswer(option)
  }

  const handleConfirmCustom = () => {
    if (!question || disabled) return
    const written = customDraft.trim()
    if (!written && question.type !== 'multiple') return

    if (question.type === 'multiple') {
      if (multipleDraft.length === 0 && !written) return
      recordAnswer(multipleDraft, written || undefined)
      return
    }

    if (question.type === 'single') {
      recordAnswer(undefined, written)
      return
    }
  }

  const handleContinueMultiple = () => {
    if (!question || disabled) return
    const written = writingCustom ? customDraft.trim() : ''
    if (multipleDraft.length === 0 && !written) return
    recordAnswer(multipleDraft, written || undefined)
  }

  const handleContinueText = () => {
    if (!question || disabled) return
    const value = textDraft.trim()
    if (!value) return
    recordAnswer(value)
  }

  const toggleMultiple = (option: string) => {
    setMultipleDraft((current) =>
      current.includes(option) ? current.filter((item) => item !== option) : [...current, option],
    )
  }

  useEffect(() => {
    if (!question || writingCustom || question.type === 'text') return
    panelRef.current?.focus()
  }, [question, stepIndex, writingCustom])

  if (!question) return null

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return

    if (event.key === 'Escape' && writingCustom) {
      event.preventDefault()
      setWritingCustom(false)
      setCustomDraft(records[question.id]?.written ?? '')
      return
    }

    if (question.type === 'text') return
    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    if (tag === 'TEXTAREA' || tag === 'INPUT' || target?.isContentEditable) return

    const options = question.options ?? []
    const digit = Number(event.key)
    if (digit < 1 || digit > options.length) return
    const option = options[digit - 1]
    if (!option) return
    event.preventDefault()
    if (question.type === 'multiple') {
      toggleMultiple(option)
      return
    }
    recordAnswer(option)
  }

  const answeredTrail = questions
    .slice(0, stepIndex)
    .map((item, index) => {
      const record = records[item.id]
      if (!record) return null
      return { question: item, record, index }
    })
    .filter(Boolean) as Array<{ question: AgentQuestion; record: StepRecord; index: number }>

  const canContinueMultiple =
    multipleDraft.length > 0 || (writingCustom && Boolean(customDraft.trim()))
  const multipleDraftSet = new Set(multipleDraft)
  const canConfirmCustom = Boolean(customDraft.trim())
  const canContinueText = Boolean(textDraft.trim())

  const onTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleContinueText()
    }
  }

  return (
    <div
      className="mb-3 flex flex-col gap-3 px-1 outline-none"
      data-slot="agent-questions"
      onKeyDown={handlePanelKeyDown}
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
                {stepIndex + 1} of {questions.length}
              </p>
            ) : null}
          </div>
          {request.description ? (
            <p className="text-muted-foreground text-xs">{request.description}</p>
          ) : null}
        </div>
      </div>

      {answeredTrail.length > 0 ? (
        <AnsweredTrail disabled={disabled} onJump={goToStep} trail={answeredTrail} />
      ) : null}

      <QuestionStep
        advanceLabel={advanceLabel}
        baseId={baseId}
        canConfirmCustom={canConfirmCustom}
        canContinueMultiple={canContinueMultiple}
        canContinueText={canContinueText}
        customDraft={customDraft}
        disabled={disabled}
        key={question.id}
        multipleDraftSet={multipleDraftSet}
        onConfirmCustom={handleConfirmCustom}
        onContinueMultiple={handleContinueMultiple}
        onContinueText={handleContinueText}
        onSelectSingle={handleSingleSelect}
        onSkip={handleSkip}
        onTextKeyDown={onTextKeyDown}
        onToggleMultiple={toggleMultiple}
        question={question}
        records={records}
        setCustomDraft={setCustomDraft}
        setTextDraft={setTextDraft}
        setWritingCustom={setWritingCustom}
        textDraft={textDraft}
        writingCustom={writingCustom}
      />
    </div>
  )
}

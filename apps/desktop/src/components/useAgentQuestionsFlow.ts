import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { AgentQuestion, AgentQuestionAnswers } from '@ark/chat/agent-questions.ts'

import {
  combineAgentQuestionAnswers,
  type AgentQuestionStepRecord,
} from './agent-questions-model.ts'

export function hydrateAgentQuestionStep(
  questions: AgentQuestion[],
  index: number,
  nextRecords: Record<string, AgentQuestionStepRecord>,
  setters: {
    setWritingCustom: (value: boolean) => void
    setCustomDraft: (value: string) => void
    setTextDraft: (value: string) => void
    setMultipleDraft: (value: string[]) => void
  },
) {
  const next = questions[index]
  if (!next) return
  const record = nextRecords[next.id]
  setters.setWritingCustom(Boolean(record?.written))
  setters.setCustomDraft(record?.written ?? '')
  if (next.type === 'text') {
    setters.setTextDraft(typeof record?.answer === 'string' ? record.answer : '')
    setters.setMultipleDraft([])
  } else if (next.type === 'multiple') {
    setters.setMultipleDraft(Array.isArray(record?.answer) ? record.answer : [])
    setters.setTextDraft('')
  } else {
    setters.setTextDraft('')
    setters.setMultipleDraft([])
  }
}

export function useAgentQuestionsFlow(
  questions: AgentQuestion[],
  disabled: boolean,
  onSubmit: (answers: AgentQuestionAnswers) => void,
) {
  const [stepIndex, setStepIndex] = useState(0)
  const [records, setRecords] = useState<Record<string, AgentQuestionStepRecord>>({})
  const [writingCustom, setWritingCustom] = useState(false)
  const [customDraft, setCustomDraft] = useState('')
  const [textDraft, setTextDraft] = useState('')
  const [multipleDraft, setMultipleDraft] = useState<string[]>([])
  const setters = { setWritingCustom, setCustomDraft, setTextDraft, setMultipleDraft }
  const question = questions[stepIndex]

  const goToStep = (index: number) => {
    setStepIndex(index)
    hydrateAgentQuestionStep(questions, index, records, setters)
  }

  const finishOrAdvance = (
    nextRecords: Record<string, AgentQuestionStepRecord>,
    fromIndex: number,
  ) => {
    if (fromIndex >= questions.length - 1) {
      onSubmit(combineAgentQuestionAnswers(questions, nextRecords))
      return
    }
    const nextIndex = fromIndex + 1
    setStepIndex(nextIndex)
    hydrateAgentQuestionStep(questions, nextIndex, nextRecords, setters)
  }

  const recordAnswer = (
    answer: string | string[] | undefined,
    written?: string,
    status: AgentQuestionStepRecord['status'] = 'answered',
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

  return {
    customDraft,
    handleConfirmCustom,
    handleContinueMultiple,
    handleContinueText,
    handleSkip: () => recordAnswer(undefined, undefined, 'skipped'),
    goToStep,
    multipleDraft,
    question,
    recordAnswer,
    records,
    setCustomDraft,
    setTextDraft,
    setWritingCustom,
    stepIndex,
    textDraft,
    toggleMultiple,
    writingCustom,
  }
}

export function handleAgentQuestionsPanelKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  input: {
    disabled: boolean
    writingCustom: boolean
    question: AgentQuestion
    records: Record<string, AgentQuestionStepRecord>
    setWritingCustom: (value: boolean) => void
    setCustomDraft: (value: string) => void
    toggleMultiple: (option: string) => void
    recordAnswer: (answer: string | string[] | undefined) => void
  },
) {
  if (input.disabled) return

  if (event.key === 'Escape' && input.writingCustom) {
    event.preventDefault()
    input.setWritingCustom(false)
    input.setCustomDraft(input.records[input.question.id]?.written ?? '')
    return
  }

  if (input.question.type === 'text') return
  const target = event.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT' || target?.isContentEditable) return

  const options = input.question.options ?? []
  const digit = Number(event.key)
  if (digit < 1 || digit > options.length) return
  const option = options[digit - 1]
  if (!option) return
  event.preventDefault()
  if (input.question.type === 'multiple') {
    input.toggleMultiple(option)
    return
  }
  input.recordAnswer(option)
}

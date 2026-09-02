import type { AgentQuestion, AgentQuestionAnswers } from '@ark/chat/agent-questions.ts'

export type AgentQuestionStepRecord = {
  status: 'answered' | 'skipped'
  answer?: string | string[]
  written?: string
}

export function formatAgentQuestionTrailAnswer(
  question: AgentQuestion,
  record: AgentQuestionStepRecord,
) {
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

export function combineAgentQuestionAnswers(
  questions: AgentQuestion[],
  records: Record<string, AgentQuestionStepRecord>,
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

import { describe, expect, it } from 'vitest'

import {
  agentQuestionRequestSchema,
  formatAgentQuestionAnswers,
  parseAgentQuestionAnswerLines,
} from './agent-questions.ts'

describe('agent questions', () => {
  it('validates all question types and formats their answers for chat', () => {
    const request = agentQuestionRequestSchema.parse({
      title: 'Before I start',
      questions: [
        { id: 'audience', question: 'Who is this for?', type: 'text' },
        {
          id: 'length',
          question: 'How long?',
          type: 'single',
          options: ['5 slides', '10 slides'],
        },
        {
          id: 'priorities',
          question: 'What matters most?',
          type: 'multiple',
          options: ['Story', 'Data'],
        },
      ],
    })

    const formatted = formatAgentQuestionAnswers(request, {
      audience: 'Investors',
      length: '5 slides',
      priorities: ['Story', 'Data'],
    })
    expect(formatted).toContain('- What matters most?: Story, Data')
    expect(parseAgentQuestionAnswerLines(request, formatted)).toEqual({
      audience: 'Investors',
      length: '5 slides',
      priorities: 'Story, Data',
    })
  })

  it('rejects choice questions without options', () => {
    expect(
      agentQuestionRequestSchema.safeParse({
        title: 'Questions',
        questions: [{ id: 'length', question: 'How long?', type: 'single' }],
      }).success,
    ).toBe(false)
  })
})

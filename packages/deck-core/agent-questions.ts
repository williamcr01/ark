import { z } from 'zod'

export const agentQuestionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_-]+$/),
    question: z.string().min(1).max(240),
    type: z.enum(['single', 'multiple', 'text']),
    options: z.array(z.string().min(1).max(120)).min(2).max(7).optional(),
    placeholder: z.string().max(160).optional(),
    required: z.boolean().optional().default(true),
  })
  .superRefine((question, context) => {
    if (question.type !== 'text' && !question.options) {
      context.addIssue({
        code: 'custom',
        message: `${question.type} questions require options.`,
        path: ['options'],
      })
    }
  })

export const agentQuestionRequestSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(240).optional(),
  questions: z.array(agentQuestionSchema).min(1).max(5),
})

export type AgentQuestion = z.infer<typeof agentQuestionSchema>
export type AgentQuestionRequest = z.infer<typeof agentQuestionRequestSchema>
export type AgentQuestionAnswers = Record<string, string | string[]>

export function formatAgentQuestionAnswers(
  request: AgentQuestionRequest,
  answers: AgentQuestionAnswers,
) {
  return [
    `${request.title}: answers:`,
    ...request.questions.map((question) => {
      const answer = answers[question.id]
      const value = Array.isArray(answer) ? answer.join(', ') : answer
      return `- ${question.question}: ${value?.trim() || 'No answer'}`
    }),
  ].join('\n')
}

/** Recover per-question display answers from a formatted answer message. */
export function parseAgentQuestionAnswerLines(
  request: AgentQuestionRequest,
  content: string,
): Record<string, string> {
  const lines = content.split('\n')
  const parsed: Record<string, string> = {}

  for (const question of request.questions) {
    const prefix = `- ${question.question}: `
    const line = lines.find((entry) => entry.startsWith(prefix))
    parsed[question.id] = line ? line.slice(prefix.length).trim() || 'No answer' : 'No answer'
  }

  return parsed
}

import {
  parseAgentQuestionAnswerLines,
  type AgentQuestionRequest,
} from '@ark/chat/agent-questions.ts'

export function AskUserTranscript({
  request,
  answersContent,
}: {
  request: AgentQuestionRequest
  answersContent?: string | null
}) {
  const count = request.questions.length
  const answered = Boolean(answersContent)
  const answers = answersContent ? parseAgentQuestionAnswerLines(request, answersContent) : null

  return (
    <details className="text-xs" open={answered}>
      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
        {answered
          ? `Answered ${count} question${count === 1 ? '' : 's'}`
          : `Asked ${count} question${count === 1 ? '' : 's'}`}
      </summary>
      {answered && answers ? (
        <div className="mt-1.5 flex flex-col gap-2 pl-4">
          {request.title ? (
            <p className="text-muted-foreground/80 text-[11px]">{request.title}</p>
          ) : null}
          {request.questions.map((question) => (
            <div className="flex flex-col gap-0.5" key={question.id}>
              <p className="text-foreground font-medium">{question.question}</p>
              <p className="text-muted-foreground">{answers[question.id] ?? 'No answer'}</p>
            </div>
          ))}
        </div>
      ) : null}
    </details>
  )
}

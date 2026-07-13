# Agent context

Ark keeps durable chat and provider context as separate representations.

Durable assistant messages are an append-only logical transcript of assistant text, tool calls,
and tool results. Tool-specific projectors remove duplicate deck HTML and bound individual values
while retaining hashes, targets, results, errors, and instructions for re-reading authoritative
deck state. Completed steps are not deleted to satisfy a model budget.

`assembleDeckAgentContext` transforms that durable history immediately before `generateText`. It
validates tool pairing, retains recent complete steps, and replaces older model-only context with a
deterministic semantic ledger when the emergency 96KB per-turn ceiling is reached. This projection
does not mutate or persist markers back into chat. The AI SDK owns continuation between tool steps
inside one generation job.

## Future compaction contract

Session compaction is not implemented. A future `ChatCompactionEntry` should live separately from
append-only `chat_messages` and record a structured summary, `firstKeptMessageId`, tokens before
compaction, model, and previous compaction id. Context assembly would then emit system prompt,
compaction summary, and exact recent messages.

Compaction should trigger from estimated input tokens and a reserved-output budget, keep a
configurable recent-token window exactly, and never split a tool call from its result. Summaries
must preserve deck operations, changed slides/elements, errors, constraints, and decisions. Branch
summaries, steering, and follow-up queues remain out of scope.

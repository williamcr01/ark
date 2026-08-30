import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { McpInteractionAnswer, McpPendingInteraction } from '@ark/contracts'

/**
 * Tracks the interaction an external MCP agent is waiting on, scoped to the open deck.
 * An interaction raised against another deck stays pending but is not surfaced here.
 */
export function useMcpInteraction(deckId: string | null) {
  const [mcpInteraction, setMcpInteraction] = useState<McpPendingInteraction | null>(null)

  useEffect(() => {
    let canceled = false
    void window.arkDesktop.mcp.getPendingInteraction().then((interaction) => {
      if (!canceled) setMcpInteraction(interaction)
    })
    const unsubscribe = window.arkDesktop.mcp.onInteractionChanged(({ interaction }) => {
      setMcpInteraction(interaction)
    })
    return () => {
      canceled = true
      unsubscribe()
    }
  }, [])

  const activeMcpInteraction = mcpInteraction?.deckId === deckId ? mcpInteraction : null

  const respondToMcpInteraction = useCallback(
    async (answer: McpInteractionAnswer) => {
      if (!activeMcpInteraction) return
      try {
        await window.arkDesktop.mcp.respondToInteraction(activeMcpInteraction.id, answer)
        toast.success('Response sent to the external agent')
      } catch (responseError) {
        toast.error(
          responseError instanceof Error ? responseError.message : 'Could not send the response',
        )
      }
    },
    [activeMcpInteraction],
  )

  const cancelMcpInteraction = useCallback(async () => {
    if (!activeMcpInteraction) return
    try {
      await window.arkDesktop.mcp.cancelInteraction(activeMcpInteraction.id)
    } catch (cancelError) {
      toast.error(
        cancelError instanceof Error ? cancelError.message : 'Could not cancel the interaction',
      )
    }
  }, [activeMcpInteraction])

  return { activeMcpInteraction, cancelMcpInteraction, respondToMcpInteraction }
}

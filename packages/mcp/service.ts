import { timingSafeEqual } from 'node:crypto'

export class McpServiceState {
  private capability: Buffer | null = null
  private activeDeckId: string | null = null

  start(capability: string) {
    this.capability = Buffer.from(capability)
  }

  stop() {
    this.capability = null
  }

  isRunning() {
    return this.capability !== null
  }

  authenticate(capability: string) {
    if (!this.capability) return false
    const candidate = Buffer.from(capability)
    return (
      candidate.length === this.capability.length && timingSafeEqual(candidate, this.capability)
    )
  }

  setActiveDeck(deckId: string | null) {
    this.activeDeckId = deckId
  }

  getActiveDeck() {
    return this.activeDeckId
  }
}

export function createMcpServiceState() {
  return new McpServiceState()
}

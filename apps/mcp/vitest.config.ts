import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@ark/mcp-server',
    environment: 'node',
    include: ['**/*.test.ts'],
  },
})

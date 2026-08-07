import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@ark/mcp',
    environment: 'node',
    include: ['**/*.test.ts'],
  },
})

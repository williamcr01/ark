import path from 'node:path'

import { buildRuntimeRegistryPromptSection } from '@ark/runtime-registry/deck-runtime-registry.ts'
import { buildAgentGuidesPromptSection } from './agent-guides.ts'
import { REPO_ROOT } from '@ark/storage/fs/repo-root.ts'

export function buildMcpAuthoringGuide() {
  const directory = process.env.ARK_MCP_GUIDES_DIR?.trim() || path.join(REPO_ROOT, 'mcp-guides')
  const guides = buildAgentGuidesPromptSection({
    env: {
      ...process.env,
      ARK_AGENT_GUIDES_DIR: directory,
      ARK_AGENT_GUIDES_MAX_BYTES:
        process.env.ARK_MCP_GUIDES_MAX_BYTES ?? process.env.ARK_AGENT_GUIDES_MAX_BYTES,
    },
  })

  return `# Ark MCP authoring guide

You are editing an Ark presentation as an expert presentation designer and front-end engineer. Follow these rules before using the deck editing tools.

## Approved runtime libraries

Use these exact Ark-served URLs only; never use CDNs.

${buildRuntimeRegistryPromptSection()}

${guides}`
}

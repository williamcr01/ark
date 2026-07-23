import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  agentGuidesTestUtils,
  buildAgentGuidesPromptSection,
  loadAgentGuides,
  resetAgentGuidesCache,
} from './agent-guides.ts'
import { buildDeckAgentSystemPrompt } from './deck-agent.ts'

function writeGuideDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ark-agent-guides-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content, 'utf8')
  }
  return dir
}

afterEach(() => {
  resetAgentGuidesCache()
  vi.restoreAllMocks()
})

describe('agent guide filename rules', () => {
  it('excludes README and underscore-prefixed files', () => {
    expect(agentGuidesTestUtils.isEligibleGuideFilename('10-reveal-js.md')).toBe(true)
    expect(agentGuidesTestUtils.isEligibleGuideFilename('README.md')).toBe(false)
    expect(agentGuidesTestUtils.isEligibleGuideFilename('readme.md')).toBe(false)
    expect(agentGuidesTestUtils.isEligibleGuideFilename('_draft.md')).toBe(false)
    expect(agentGuidesTestUtils.isEligibleGuideFilename('notes.txt')).toBe(false)
  })

  it('derives guide ids from numeric prefixes', () => {
    expect(agentGuidesTestUtils.guideIdFromFilename('10-reveal-js.md')).toBe('reveal-js')
    expect(agentGuidesTestUtils.guideIdFromFilename('20-chart-js.md')).toBe('chart-js')
    expect(agentGuidesTestUtils.guideIdFromFilename('00_plain.md')).toBe('plain')
    expect(agentGuidesTestUtils.guideIdFromFilename('bridge.md')).toBe('bridge')
  })
})

describe('loadAgentGuides', () => {
  it('loads eligible markdown in lexicographic order and skips README/_ files', () => {
    const dir = writeGuideDir({
      '20-second.md': 'Second guide body.',
      '10-first.md': 'First guide body.',
      'README.md': 'Human docs only.',
      '_hidden.md': 'Should not load.',
      'notes.txt': 'Ignored.',
    })

    const loaded = loadAgentGuides({
      env: { ...process.env, ARK_AGENT_GUIDES_DIR: dir },
      forceReload: true,
    })

    expect(loaded.sections.map((section) => section.id)).toEqual(['first', 'second'])
    expect(loaded.sections.map((section) => section.content)).toEqual([
      'First guide body.',
      'Second guide body.',
    ])
    expect(loaded.truncated).toBe(false)
  })

  it('formats sections with Guide headers', () => {
    const dir = writeGuideDir({
      '10-reveal-js.md': 'Use .reveal > .slides > section.',
    })

    const section = buildAgentGuidesPromptSection({
      env: { ...process.env, ARK_AGENT_GUIDES_DIR: dir },
      forceReload: true,
    })

    expect(section).toContain('## Guide: reveal-js')
    expect(section).toContain('Use .reveal > .slides > section.')
  })

  it('strips YAML frontmatter while keeping the body', () => {
    const dir = writeGuideDir({
      '10-topic.md': '---\nenabled: true\n---\nBody after frontmatter.\n',
    })

    const loaded = loadAgentGuides({
      env: { ...process.env, ARK_AGENT_GUIDES_DIR: dir },
      forceReload: true,
    })

    expect(loaded.sections).toHaveLength(1)
    expect(loaded.sections[0].content).toBe('Body after frontmatter.')
  })

  it('truncates when ARK_AGENT_GUIDES_MAX_BYTES is exceeded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dir = writeGuideDir({
      '10-long.md': 'x'.repeat(500),
    })

    const loaded = loadAgentGuides({
      env: {
        ...process.env,
        ARK_AGENT_GUIDES_DIR: dir,
        ARK_AGENT_GUIDES_MAX_BYTES: '80',
      },
      forceReload: true,
    })

    expect(loaded.truncated).toBe(true)
    expect(loaded.sections).toHaveLength(1)
    expect(loaded.sections[0].content).toContain('[agent guide truncated]')
    expect(loaded.totalBytes).toBeLessThanOrEqual(80)
    expect(warn).toHaveBeenCalled()
  })

  it('returns empty sections when the directory is missing', () => {
    const missing = path.join(tmpdir(), 'ark-agent-guides-missing-dir')
    const loaded = loadAgentGuides({
      env: { ...process.env, ARK_AGENT_GUIDES_DIR: missing },
      forceReload: true,
    })
    expect(loaded.sections).toEqual([])
    expect(loaded.totalBytes).toBe(0)
  })

  it('does not recurse into subdirectories', () => {
    const dir = writeGuideDir({ '10-root.md': 'Root guide.' })
    mkdirSync(path.join(dir, 'nested'))
    writeFileSync(path.join(dir, 'nested', 'nested.md'), 'Nested guide.', 'utf8')

    const loaded = loadAgentGuides({
      env: { ...process.env, ARK_AGENT_GUIDES_DIR: dir },
      forceReload: true,
    })

    expect(loaded.sections.map((section) => section.id)).toEqual(['root'])
  })
})

describe('buildDeckAgentSystemPrompt with agent guides', () => {
  it('appends reference guides from ARK_AGENT_GUIDES_DIR', () => {
    const dir = writeGuideDir({
      '10-reveal-js.md': 'UNIQUE_GUIDE_MARKER_reveal_stacks.',
    })
    resetAgentGuidesCache()
    const previous = process.env.ARK_AGENT_GUIDES_DIR
    process.env.ARK_AGENT_GUIDES_DIR = dir
    try {
      const prompt = buildDeckAgentSystemPrompt()
      expect(prompt).toContain('# Reference guides')
      expect(prompt).toContain('## Guide: reveal-js')
      expect(prompt).toContain('UNIQUE_GUIDE_MARKER_reveal_stacks.')
      expect(prompt).toContain('self-contained')
    } finally {
      if (previous === undefined) {
        delete process.env.ARK_AGENT_GUIDES_DIR
      } else {
        process.env.ARK_AGENT_GUIDES_DIR = previous
      }
      resetAgentGuidesCache()
    }
  })

  it('includes the repo Chart.js agent guide in the default system prompt', () => {
    resetAgentGuidesCache()
    const previous = process.env.ARK_AGENT_GUIDES_DIR
    delete process.env.ARK_AGENT_GUIDES_DIR
    try {
      const prompt = buildDeckAgentSystemPrompt()
      expect(prompt).toContain('## Guide: chart-js')
      expect(prompt).toContain('data-ark-runtime-lib="chart.js"')
      expect(prompt).toContain('/api/runtimes/chart.js/4.5.1/chart.umd.min.js')
      expect(prompt).toContain('Prefer **inline SVG**')
      expect(prompt).not.toContain('Charts (prefer the lightest option that fits)')
    } finally {
      if (previous === undefined) {
        delete process.env.ARK_AGENT_GUIDES_DIR
      } else {
        process.env.ARK_AGENT_GUIDES_DIR = previous
      }
      resetAgentGuidesCache()
    }
  })

  it('includes manual-edit compatibility guidance in the default system prompt', () => {
    resetAgentGuidesCache()
    const previous = process.env.ARK_AGENT_GUIDES_DIR
    delete process.env.ARK_AGENT_GUIDES_DIR
    try {
      const prompt = buildDeckAgentSystemPrompt()
      expect(prompt).toContain('## Manual-edit compatibility')
      expect(prompt).toContain('directly in the source HTML')
      expect(prompt).toContain('DOM created only at runtime cannot map back to source HTML')
    } finally {
      if (previous === undefined) {
        delete process.env.ARK_AGENT_GUIDES_DIR
      } else {
        process.env.ARK_AGENT_GUIDES_DIR = previous
      }
      resetAgentGuidesCache()
    }
  })
})

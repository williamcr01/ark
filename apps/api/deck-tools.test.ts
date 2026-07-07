import { describe, expect, it } from 'vitest'

import { createDeckTools } from './deck-tools.ts'
import { createDeckWorkspace } from './deck-workspace.ts'

const managedDeck = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Managed Deck</title>
  <style>section.slide { width: 100vw; height: 100vh; }</style>
</head>
<body>
  <section class="slide" data-ark-slide-id="ark-slide-title">
    <h1 data-ark-id="ark-el-title" data-ark-editable="true" data-ark-role="title">Opening</h1>
    <p data-ark-id="ark-el-locked" data-ark-locked="true">Do not edit</p>
  </section>
</body>
</html>`

type ToolExecute = (input: unknown, options: unknown) => Promise<Record<string, unknown>>

function runPatchElement(html: string, operations: unknown[]) {
  const workspace = createDeckWorkspace(html)
  const tools = createDeckTools(workspace)
  const execute = tools.patch_element.execute as unknown as ToolExecute
  return { workspace, result: execute({ operations }, {}) }
}

describe('patch_element tool', () => {
  it('replaces text on a selected element by id', async () => {
    const { workspace, result } = runPatchElement(managedDeck, [
      {
        op: 'replace_text',
        slideId: 'ark-slide-title',
        elementId: 'ark-el-title',
        text: 'Sharper opening',
      },
    ])

    const output = await result
    expect(output.ok).toBe(true)
    expect(output.changedElementIds).toContain('ark-el-title')
    expect(workspace.html).toContain('Sharper opening')
    expect(workspace.changed).toBe(true)
  })

  it('returns an error for a stale (missing) element id', async () => {
    const { workspace, result } = runPatchElement(managedDeck, [
      {
        op: 'replace_text',
        slideId: 'ark-slide-title',
        elementId: 'ark-el-does-not-exist',
        text: 'nope',
      },
    ])

    const output = await result
    expect(output.ok).toBe(false)
    expect(typeof output.error).toBe('string')
    expect(workspace.changed).toBe(false)
  })

  it('refuses to edit a locked element', async () => {
    const { workspace, result } = runPatchElement(managedDeck, [
      {
        op: 'replace_text',
        slideId: 'ark-slide-title',
        elementId: 'ark-el-locked',
        text: 'forced edit',
      },
    ])

    const output = await result
    expect(output.ok).toBe(false)
    expect(workspace.html).toContain('Do not edit')
    expect(workspace.changed).toBe(false)
  })

  it('errors when no deck is loaded', async () => {
    const { result } = runPatchElement('', [
      { op: 'replace_text', elementId: 'ark-el-title', text: 'x' },
    ])

    const output = await result
    expect(output.ok).toBe(false)
  })
})

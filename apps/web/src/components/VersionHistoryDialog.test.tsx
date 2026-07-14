import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DeckVersionDetail, DeckVersionSummary } from '@/lib/deck-api'

import { VersionHistoryDialog } from './VersionHistoryDialog'

const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'

function summary(overrides: Partial<DeckVersionSummary> = {}): DeckVersionSummary {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    deckId,
    versionNumber: 1,
    title: 'Deck',
    source: 'upload',
    summary: 'Uploaded HTML',
    validationStatus: 'valid',
    runtimeManifest: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    isActive: false,
    provenance: null,
    diff: null,
    ...overrides,
  }
}

function detail(overrides: Partial<DeckVersionDetail> = {}): DeckVersionDetail {
  return {
    ...summary(),
    html: '<!DOCTYPE html><html><head><title>Deck</title></head><body><section class="slide"><h1>Hello</h1></section></body></html>',
    ...overrides,
  }
}

const versions: DeckVersionSummary[] = [
  summary({
    id: 'a0000000-0000-4000-8000-000000000004',
    versionNumber: 4,
    source: 'rollback',
    summary: 'Restored version 2',
    isActive: true,
    provenance: {
      restoredVersionId: 'a0000000-0000-4000-8000-000000000002',
      restoredVersionNumber: 2,
    },
    diff: {
      kind: 'structural',
      changedSlides: [{ index: 0, contentChanged: true }],
    },
  }),
  summary({
    id: 'a0000000-0000-4000-8000-000000000003',
    versionNumber: 3,
    source: 'agent',
    summary: 'Generated slides',
    modelProvider: 'openai',
    modelName: 'gpt-5',
    provenance: {
      jobId: 'job-1',
      stepCount: 2,
      toolCalls: [{ toolName: 'write_deck', summary: 'Wrote deck' }],
    },
    diff: {
      kind: 'structural',
      addedSlides: [{ index: 1, title: 'Agenda' }],
    },
  }),
  summary({
    id: 'a0000000-0000-4000-8000-000000000002',
    versionNumber: 2,
    source: 'manual',
    summary: 'Undo: Edited text in preview',
    provenance: {
      operations: ['undo'],
      slideIndexes: [0],
      elementIds: ['el-1'],
    },
    diff: {
      kind: 'structural',
      changedSlides: [{ index: 0, contentChanged: true }],
    },
  }),
  summary({
    id: 'a0000000-0000-4000-8000-000000000001',
    versionNumber: 1,
    source: 'upload',
    summary: 'Uploaded HTML',
    // Legacy: no provenance/diff fields
  }),
]

function renderDialog(overrides: Partial<Parameters<typeof VersionHistoryDialog>[0]> = {}) {
  const onInspectVersion = vi.fn().mockResolvedValue(null)
  const onRefreshVersions = vi.fn().mockResolvedValue(versions)
  const onRollback = vi.fn().mockResolvedValue(undefined)
  const onClearPreview = vi.fn()
  const onOpenChange = vi.fn()

  render(
    <VersionHistoryDialog
      activeVersionId="a0000000-0000-4000-8000-000000000004"
      deckTitle="Demo Deck"
      onClearPreview={onClearPreview}
      onInspectVersion={onInspectVersion}
      onOpenChange={onOpenChange}
      onRefreshVersions={onRefreshVersions}
      onRollback={onRollback}
      open
      previewVersion={null}
      versions={versions}
      {...overrides}
    />,
  )

  return { onInspectVersion, onRefreshVersions, onRollback, onClearPreview, onOpenChange }
}

describe('VersionHistoryDialog', () => {
  it('renders compact provenance chips per source without loading HTML', () => {
    renderDialog()

    expect(screen.getByText('Restored v2')).toBeInTheDocument()
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
    expect(screen.getByText('+1 slide')).toBeInTheDocument()
    expect(screen.getByText('Undo')).toBeInTheDocument()
    expect(screen.getAllByText('1 slide changed').length).toBeGreaterThanOrEqual(1)

    // Legacy upload row still lists without provenance chips crashing.
    expect(screen.getAllByText('Uploaded HTML').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByTitle(/preview/i)).not.toBeInTheDocument()
  })

  it('shows provenance detail for a selected version from summary metadata', async () => {
    const user = userEvent.setup()
    const { onInspectVersion } = renderDialog()

    await user.click(screen.getByRole('button', { name: /Version 3/i }))

    expect(onInspectVersion).toHaveBeenCalledWith('a0000000-0000-4000-8000-000000000003')

    // Detail pane uses list summary fields immediately (no HTML required).
    expect(screen.getByText('Generation job')).toBeInTheDocument()
    expect(screen.getByText('job-1')).toBeInTheDocument()
    expect(screen.getByText('write_deck: Wrote deck')).toBeInTheDocument()
    expect(screen.getByText('openai / gpt-5')).toBeInTheDocument()
    expect(screen.getByText('+1 slide')).toBeInTheDocument()
    expect(screen.queryByTitle('Version 3 preview')).not.toBeInTheDocument()
  })

  it('links rollback restored version to the target list entry', async () => {
    const user = userEvent.setup()
    const { onInspectVersion } = renderDialog()

    await user.click(screen.getByRole('button', { name: /Version 4/i }))
    expect(onInspectVersion).toHaveBeenCalledWith('a0000000-0000-4000-8000-000000000004')

    const restoredLink = screen.getByRole('button', { name: 'Version 2' })
    await user.click(restoredLink)

    expect(onInspectVersion).toHaveBeenCalledWith('a0000000-0000-4000-8000-000000000002')
  })

  it('handles legacy versions with null provenance gracefully in the detail pane', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: /Version 1/i }))

    expect(screen.getAllByText('Uploaded HTML').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Operations')).not.toBeInTheDocument()
    expect(screen.queryByText('Generation job')).not.toBeInTheDocument()
  })

  it('sets empty allow and credentialless on the version preview iframe', async () => {
    const user = userEvent.setup()
    const preview = detail({
      id: 'a0000000-0000-4000-8000-000000000003',
      versionNumber: 3,
      source: 'agent',
      summary: 'Generated slides',
    })

    renderDialog({
      previewVersion: preview,
      onInspectVersion: vi.fn().mockResolvedValue(preview),
    })

    await user.click(screen.getByRole('button', { name: /Version 3/i }))

    const iframe = await screen.findByTitle('Version 3 preview')

    expect(iframe).toHaveAttribute('allow', '')
    expect(iframe).toHaveAttribute('credentialless')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    expect(iframe).toHaveAttribute('referrerPolicy', 'no-referrer')
  })
})

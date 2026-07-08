import { describe, expect, it } from 'vitest'

import type { DeckVersionSummary } from '@/lib/deck-api'

import {
  findRestoredVersion,
  getVersionHistoryChips,
  getVersionHistoryDetailSections,
} from './version-history-display'

const baseVersion = {
  id: 'a0000000-0000-4000-8000-000000000001',
  deckId: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  versionNumber: 3,
  title: 'Deck',
  summary: 'Edited text',
  validationStatus: 'valid' as const,
  runtimeManifest: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  isActive: true,
}

function version(overrides: Partial<DeckVersionSummary> = {}): DeckVersionSummary {
  return {
    ...baseVersion,
    source: 'manual',
    ...overrides,
  }
}

describe('getVersionHistoryChips', () => {
  it('returns empty chips for legacy versions without provenance or diff', () => {
    expect(getVersionHistoryChips(version({ provenance: null, diff: null }))).toEqual([])
  })

  it('shows structural slide chips and undo label for manual versions', () => {
    expect(
      getVersionHistoryChips(
        version({
          provenance: {
            operations: ['undo'],
            slideIndexes: [0],
            elementIds: ['el-1'],
          },
          diff: {
            kind: 'structural',
            changedSlides: [{ index: 0, contentChanged: true }],
            addedSlides: [{ index: 1, title: 'New' }],
            movedSlides: [{ fromIndex: 2, toIndex: 3 }],
          },
        }),
      ),
    ).toEqual([
      { key: 'added', label: '+1 slide' },
      { key: 'changed', label: '1 slide changed' },
      { key: 'moved', label: '1 slide moved' },
      { key: 'history-op', label: 'Undo' },
    ])
  })

  it('shows title and asset chips for structural diffs without slide edits', () => {
    expect(
      getVersionHistoryChips(
        version({
          provenance: { operations: ['set_attrs'] },
          diff: {
            kind: 'structural',
            titleChanged: true,
            assetsAdded: ['/api/assets/a', '/api/assets/b'],
            assetsRemoved: ['/api/assets/old'],
          },
        }),
      ),
    ).toEqual([
      { key: 'title', label: 'Title changed' },
      { key: 'assets-added', label: '+2 assets' },
      { key: 'assets-removed', label: '−1 asset' },
    ])
  })

  it('shows model name and restored version chips', () => {
    expect(
      getVersionHistoryChips(
        version({
          source: 'agent',
          modelName: 'gpt-5',
          provenance: { jobId: 'job-1', stepCount: 3 },
          diff: { kind: 'coarse', htmlBytesBefore: 10, htmlBytesAfter: 20 },
        }),
      ),
    ).toEqual([
      { key: 'model', label: 'gpt-5' },
      { key: 'coarse', label: 'Content updated' },
    ])

    expect(
      getVersionHistoryChips(
        version({
          source: 'rollback',
          provenance: {
            restoredVersionId: 'a0000000-0000-4000-8000-000000000004',
            restoredVersionNumber: 4,
          },
        }),
      ),
    ).toEqual([{ key: 'restored', label: 'Restored v4' }])
  })
})

describe('getVersionHistoryDetailSections', () => {
  it('returns no sections for legacy null provenance/diff', () => {
    expect(getVersionHistoryDetailSections(version({ provenance: null, diff: null }))).toEqual([])
  })

  it('describes manual provenance and structural diff', () => {
    const sections = getVersionHistoryDetailSections(
      version({
        provenance: {
          operations: ['replace_text', 'move_element'],
          slideIndexes: [0, 1],
          elementIds: ['a', 'b'],
        },
        diff: {
          kind: 'structural',
          changedSlides: [{ index: 0, contentChanged: true }],
          assetsAdded: ['/api/assets/x'],
        },
      }),
    )

    expect(sections).toEqual(
      expect.arrayContaining([
        { key: 'operations', label: 'Operations', value: 'replace_text, move_element' },
        { key: 'slides', label: 'Slides', value: '1, 2' },
        { key: 'elements', label: 'Elements', value: '2 elements' },
        { key: 'slide-diff', label: 'Slide changes', value: '1 changed' },
        { key: 'assets-added', label: 'Assets added', value: '1 asset' },
      ]),
    )
  })

  it('describes coarse diffs and asset counts without dumping URLs', () => {
    expect(
      getVersionHistoryDetailSections(
        version({
          diff: {
            kind: 'coarse',
            htmlBytesBefore: 10,
            htmlBytesAfter: 20,
          },
        }),
      ),
    ).toEqual([{ key: 'diff-kind', label: 'Diff', value: 'Coarse (10 → 20 bytes)' }])

    expect(
      getVersionHistoryDetailSections(
        version({
          diff: {
            kind: 'structural',
            titleChanged: true,
            assetsAdded: ['/api/assets/a', 'data:image/png;base64,AAAA'],
            assetsRemoved: ['/api/assets/old'],
          },
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        { key: 'title-changed', label: 'Title', value: 'Changed' },
        { key: 'assets-added', label: 'Assets added', value: '2 assets' },
        { key: 'assets-removed', label: 'Assets removed', value: '1 asset' },
      ]),
    )
  })

  it('describes agent tool calls and rollback target', () => {
    const sections = getVersionHistoryDetailSections(
      version({
        source: 'agent',
        modelProvider: 'openai',
        modelName: 'gpt-5',
        provenance: {
          jobId: 'job-9',
          stepCount: 4,
          toolCalls: [
            { toolName: 'read_deck', summary: 'Read slide 0' },
            { toolName: 'patch_deck', summary: 'Failed patch', error: true },
          ],
        },
      }),
    )

    expect(sections).toEqual(
      expect.arrayContaining([
        { key: 'job', label: 'Generation job', value: 'job-9' },
        { key: 'steps', label: 'Agent steps', value: '4' },
        {
          key: 'tools',
          label: 'Tool calls',
          value: 'read_deck: Read slide 0\npatch_deck (error): Failed patch',
        },
        { key: 'model', label: 'Model', value: 'openai / gpt-5' },
      ]),
    )
  })
})

describe('findRestoredVersion', () => {
  it('resolves by id or version number', () => {
    const target = version({
      id: 'a0000000-0000-4000-8000-000000000004',
      versionNumber: 4,
      isActive: false,
    })
    const versions = [target, version()]

    expect(
      findRestoredVersion(versions, {
        restoredVersionId: target.id,
        restoredVersionNumber: 4,
      }),
    ).toBe(target)

    expect(findRestoredVersion(versions, { restoredVersionNumber: 4 })).toBe(target)
    expect(findRestoredVersion(versions, null)).toBeNull()
  })
})

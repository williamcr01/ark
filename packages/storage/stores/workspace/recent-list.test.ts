import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { RecentList } from './recent-list.ts'
import type { WorkspaceRow } from './types.ts'

const row = (overrides: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Workspace',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  documentRevision: 1,
  origin: 'authored',
  html: '<html></html>',
  path: '/tmp/Workspace.ark',
  ...overrides,
})

describe('RecentList', () => {
  let root = ''
  let recents: RecentList | null = null

  afterEach(async () => {
    recents = null
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function setup() {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-recents-'))
    recents = new RecentList(path.join(root, 'recent-workspaces.json'))
    return recents
  }

  it('treats a missing index as empty and ignores invalid JSON', async () => {
    const list = await setup()
    await list.loadIfNeeded()
    expect([...list.values()]).toEqual([])

    await writeFile(path.join(root, 'recent-workspaces.json'), '{not json', 'utf8')
    const again = new RecentList(path.join(root, 'recent-workspaces.json'))
    await again.loadIfNeeded()
    expect([...again.values()]).toEqual([])
  })

  it('persists remembered rows and reloads them', async () => {
    const list = await setup()
    await list.touch(row({ path: path.join(root, 'Workspace.ark') }))

    const stored = JSON.parse(await readFile(path.join(root, 'recent-workspaces.json'), 'utf8'))
    expect(stored).toEqual([
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Workspace',
        path: path.join(root, 'Workspace.ark'),
      }),
    ])

    const reloaded = new RecentList(path.join(root, 'recent-workspaces.json'))
    await reloaded.loadIfNeeded()
    expect(reloaded.get('00000000-0000-4000-8000-000000000001')).toMatchObject({
      title: 'Workspace',
      path: path.join(root, 'Workspace.ark'),
    })
  })

  it('keeps an existing cover when remembering a later save', async () => {
    const list = await setup()
    await list.touch(row())
    const entry = list.get(row().id)!
    entry.cover = 'data:image/png;base64,cG5n'
    list.remember(row({ title: 'Renamed', updatedAt: '2026-09-02T00:00:00.000Z' }))
    expect(list.get(row().id)).toMatchObject({
      title: 'Renamed',
      cover: 'data:image/png;base64,cG5n',
    })
  })

  it('forgets other identities that still point at a path about to be overwritten', async () => {
    const list = await setup()
    const target = path.join(root, 'Taken.ark')
    await list.touch(row({ id: '00000000-0000-4000-8000-0000000000aa', path: target }))
    await list.touch(row({ id: '00000000-0000-4000-8000-0000000000bb', path: target }))

    await list.forgetAtPath(target, '00000000-0000-4000-8000-0000000000bb')

    expect(list.get('00000000-0000-4000-8000-0000000000aa')).toBeUndefined()
    expect(list.get('00000000-0000-4000-8000-0000000000bb')).toMatchObject({ path: target })
  })

  it('marks missing files and sorts by updatedAt descending', async () => {
    const list = await setup()
    const present = path.join(root, 'Present.ark')
    await writeFile(present, 'not a workspace', 'utf8')
    list.remember(row({ updatedAt: '2026-09-01T00:00:00.000Z', path: '/no/such/deck.ark' }))
    list.remember(
      row({
        id: '00000000-0000-4000-8000-000000000002',
        title: 'Present',
        updatedAt: '2026-09-02T00:00:00.000Z',
        path: present,
      }),
    )

    const summaries = await list.list(new Map())
    expect(summaries.map((entry) => ({ id: entry.id, missing: entry.missing }))).toEqual([
      { id: '00000000-0000-4000-8000-000000000002', missing: false },
      { id: '00000000-0000-4000-8000-000000000001', missing: true },
    ])
  })

  it('removes a row from memory and disk', async () => {
    const list = await setup()
    await list.touch(row())
    expect(await list.remove(row().id)).toBe(true)
    expect(list.get(row().id)).toBeUndefined()
    expect(JSON.parse(await readFile(path.join(root, 'recent-workspaces.json'), 'utf8'))).toEqual(
      [],
    )
    expect(await list.remove(row().id)).toBe(false)
  })

  it('rejects locate when the file identity does not match', async () => {
    const list = await setup()
    await expect(
      list.locate('00000000-0000-4000-8000-000000000001', path.join(root, 'missing.ark'), () =>
        row(),
      ),
    ).rejects.toThrow('Could not open Ark workspace.')
  })
})

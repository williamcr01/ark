import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  assert,
  attachCdpTargets,
  createPage,
  evaluate,
  findContextByUrl,
  getFreePort,
  openApp,
  readContext,
  repoRoot,
  setUploadFile,
  SMOKE_SLOW_TIMEOUT_MS,
  spawnChromium,
  startServers,
  stopChromium,
  stopServers,
  writeBrowserSmokeArtifacts,
  waitFor,
  type RuntimeContext,
} from './lib/browser-smoke.ts'

const plainCssFixturePath = path.join(repoRoot, 'test/fixtures/plain-css-deck.html')

type DeckVersionSummary = {
  id: string
  versionNumber: number
  source: string
  summary: string | null
  provenance: {
    operations?: string[]
    slideIndexes?: number[]
    elementIds?: string[]
  } | null
  diff: Record<string, unknown> | null
}

type StoredDeck = {
  id: string
  html: string
  title: string
}

async function listDecks(apiPort: number) {
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/decks`)
  assert(response.ok, `GET /api/decks failed: ${response.status}`)
  return (await response.json()) as Array<{ id: string; title: string }>
}

async function fetchDeck(apiPort: number, deckId: string) {
  const response = await fetch(
    `http://127.0.0.1:${apiPort}/api/decks/${encodeURIComponent(deckId)}`,
  )
  assert(response.ok, `GET /api/decks/${deckId} failed: ${response.status}`)
  return (await response.json()) as StoredDeck
}

async function fetchVersions(apiPort: number, deckId: string) {
  const response = await fetch(
    `http://127.0.0.1:${apiPort}/api/decks/${encodeURIComponent(deckId)}/versions`,
  )
  assert(response.ok, `GET /api/decks/${deckId}/versions failed: ${response.status}`)
  const body = (await response.json()) as { versions: DeckVersionSummary[] }
  return body.versions
}

async function waitForNewestVersion(
  apiPort: number,
  deckId: string,
  predicate: (version: DeckVersionSummary, versions: DeckVersionSummary[]) => boolean,
  label: string,
) {
  return waitFor(
    label,
    async () => {
      const versions = await fetchVersions(apiPort, deckId)
      const newest = versions[0]

      if (!newest) {
        return null
      }

      return predicate(newest, versions) ? newest : null
    },
    { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
  )
}

async function enterEditMode(
  cdp: Awaited<ReturnType<typeof createPage>>,
  servers: { sandboxOrigin: string },
  contexts: Map<string, RuntimeContext>,
) {
  await evaluate<boolean>(
    cdp,
    `Boolean(document.querySelector('button[aria-label="Edit mode"]')?.click())`,
  )

  await waitFor('edit mode toolbar', async () =>
    evaluate<boolean>(cdp!, `Boolean(document.querySelector('[aria-label="Edit mode toolbar"]'))`),
  )

  const editPreviewSrc = await waitFor(
    'editor-enabled sandbox preview iframe src',
    async () => {
      const src = await evaluate<string>(
        cdp!,
        `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
      )

      return src.startsWith(`${servers.sandboxOrigin}/render/`) ? src : ''
    },
    { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
  )

  const editPreview = await waitFor(
    'editor sandbox preview frame context',
    () => findContextByUrl(cdp!, contexts, editPreviewSrc),
    { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
  )

  await waitFor('editor bridge ready in preview frame', async () =>
    evaluate<boolean>(
      cdp!,
      `Boolean(document.querySelector('script[data-ark-preview-editor]'))`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    ),
  )

  await waitFor('sandbox preview loading overlay to clear', async () => {
    const loading = await evaluate<boolean>(
      cdp!,
      `document.body.innerText.includes('Loading sandbox preview')`,
    )

    return !loading
  })

  await waitFor('active slide content in edit preview', async () =>
    evaluate<boolean>(
      cdp!,
      `(() => {
        const active = document.querySelector('section.slide.active, section.slide.is-active');
        return Boolean(active && (active.textContent || '').includes('Quarterly planning'));
      })()`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    ),
  )

  return { editPreviewSrc, editPreview }
}

async function refreshEditPreviewContext(
  cdp: Awaited<ReturnType<typeof createPage>>,
  servers: { sandboxOrigin: string },
  contexts: Map<string, RuntimeContext>,
  previousSrc: string,
) {
  const editPreviewSrc = await waitFor(
    'refreshed editor sandbox preview iframe src',
    async () => {
      const src = await evaluate<string>(
        cdp!,
        `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
      )

      if (!src.startsWith(`${servers.sandboxOrigin}/render/`)) {
        return ''
      }

      // Prefer a new render URL after a patch/undo reload; fall back to the
      // current one once the frame context is healthy again.
      return src
    },
    { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
  )

  const editPreview = await waitFor(
    'refreshed editor sandbox preview frame context',
    () => findContextByUrl(cdp!, contexts, editPreviewSrc),
    { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
  )

  await waitFor('edit preview content after reload', async () =>
    evaluate<boolean>(
      cdp!,
      `Boolean(document.querySelector('section.slide.active, section.slide.is-active'))`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    ),
  )

  void previousSrc
  return { editPreviewSrc, editPreview }
}

async function waitForToolbarButtonEnabled(
  cdp: Awaited<ReturnType<typeof createPage>>,
  label: 'Undo' | 'Redo',
) {
  await waitFor(`${label} toolbar button enabled`, async () =>
    evaluate<boolean>(
      cdp!,
      `(() => {
        const button = document.querySelector('button[aria-label="${label}"]');
        return Boolean(button && !button.disabled);
      })()`,
    ),
  )
}

async function clickToolbarButton(
  cdp: Awaited<ReturnType<typeof createPage>>,
  label: 'Undo' | 'Redo',
) {
  await waitForToolbarButtonEnabled(cdp, label)
  const clicked = await evaluate<boolean>(
    cdp,
    `Boolean(document.querySelector('button[aria-label="${label}"]')?.click())`,
  )
  assert(clicked, `Could not click ${label} toolbar button`)
}

function assertManualPatchProvenance(version: DeckVersionSummary, expectedOps: string[]) {
  assert(version.source === 'manual', `Expected manual source, got ${version.source}`)
  assert(version.provenance, `Expected provenance on version ${version.versionNumber}`)
  assert(
    Array.isArray(version.provenance.operations) && version.provenance.operations.length > 0,
    `Expected provenance.operations on version ${version.versionNumber}`,
  )

  for (const op of expectedOps) {
    assert(
      version.provenance.operations!.includes(op),
      `Expected operation "${op}" in ${JSON.stringify(version.provenance.operations)}`,
    )
  }

  assert(
    Array.isArray(version.provenance.slideIndexes) && version.provenance.slideIndexes.length > 0,
    `Expected slideIndexes on version ${version.versionNumber}`,
  )
  assert(
    Array.isArray(version.provenance.elementIds) && version.provenance.elementIds.length > 0,
    `Expected elementIds on version ${version.versionNumber}`,
  )
  assert(
    version.diff && typeof version.diff === 'object',
    'Expected a diff object on patch version',
  )
}

function assertUndoRedoVersion(version: DeckVersionSummary, kind: 'undo' | 'redo') {
  const prefix = kind === 'undo' ? 'Undo:' : 'Redo:'
  assert(version.source === 'manual', `Expected manual ${kind} source`)
  assert(
    typeof version.summary === 'string' && version.summary.startsWith(prefix),
    `Expected summary starting with "${prefix}", got ${version.summary}`,
  )
  assert(version.provenance, `Expected provenance on ${kind} version`)
  assert(
    version.provenance.operations?.includes(kind),
    `Expected provenance.operations to include "${kind}"`,
  )
  assert(version.diff && typeof version.diff === 'object', `Expected diff on ${kind} version`)
}

async function runSmoke() {
  assert(existsSync(plainCssFixturePath), `Missing fixture ${plainCssFixturePath}`)

  const [apiPort, sandboxPort, webPort, debugPort] = await Promise.all([
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
  ])
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ark-manual-edit-smoke-'))
  const artifactsRoot =
    process.env.ARK_SMOKE_ARTIFACTS_DIR?.trim() || path.join(tempRoot, 'artifacts')
  let browser: Awaited<ReturnType<typeof spawnChromium>> | null = null
  let cdp: Awaited<ReturnType<typeof createPage>> | null = null
  let servers: Awaited<ReturnType<typeof startServers>> | null = null
  let mainPreviewSrc: string | null = null

  try {
    servers = await startServers({ apiPort, sandboxPort, webPort, tempRoot })

    await waitFor('API health', async () => {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`)
      return response.ok
    })

    await waitFor('Vite dev server', async () => {
      const response = await fetch(servers!.appOrigin)
      return response.ok
    })

    browser = await spawnChromium(debugPort, path.join(tempRoot, 'chromium-profile'))
    cdp = await createPage(browser.debugPort)

    const contexts = new Map<string, RuntimeContext>()

    cdp.on('Runtime.executionContextCreated', (params, sessionId) => {
      const context = readContext(params, sessionId)

      if (context) {
        contexts.set(`${context.sessionId ?? 'root'}:${context.id}`, context)
      }
    })
    cdp.on('Runtime.executionContextDestroyed', (params, sessionId) => {
      const id = (params as { executionContextId?: unknown }).executionContextId

      if (typeof id === 'number') {
        contexts.delete(`${sessionId ?? 'root'}:${id}`)
      }
    })

    await attachCdpTargets(cdp)
    await openApp(cdp, servers.appOrigin)
    await setUploadFile(cdp, plainCssFixturePath)

    await waitFor(
      'uploaded plain CSS deck in shell',
      async () => {
        const text = await evaluate<string>(cdp!, 'document.body.innerText')
        return text.includes('Plain CSS Deck') && text.includes('Slide 1 of 3')
      },
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    const decks = await waitFor('uploaded deck in API', async () => {
      const listed = await listDecks(apiPort)
      return listed.find((deck) => deck.title.includes('Plain CSS Deck')) ?? null
    })
    const deckId = decks.id

    const baseline = await fetchDeck(apiPort, deckId)
    mainPreviewSrc = (await enterEditMode(cdp, servers, contexts)).editPreviewSrc
    let editPreviewSrc = mainPreviewSrc
    let editPreview = await waitFor(
      'initial edit preview context',
      () => findContextByUrl(cdp!, contexts, editPreviewSrc),
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    // --- Text edit via real DOM events inside the sandbox iframe ---
    await evaluate<boolean>(
      cdp,
      `(() => {
        const heading = document.querySelector('section.slide.active h1, section.slide.is-active h1, h1');
        if (!heading) return false;
        heading.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
        return heading.getAttribute('contenteditable') === 'true' || Boolean(heading.closest('[contenteditable="true"]'));
      })()`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )

    await waitFor('text edit active in preview', async () =>
      evaluate<boolean>(
        cdp!,
        `Boolean(document.querySelector('[contenteditable="true"], [data-ark-editor-text-edit]'))`,
        { contextId: editPreview.id, sessionId: editPreview.sessionId },
      ),
    )

    const editedText = 'Quarterly planning (edited)'
    await evaluate<boolean>(
      cdp,
      `(() => {
        const target = document.querySelector('[contenteditable="true"], [data-ark-editor-text-edit]') || document.querySelector('h1');
        if (!target) return false;
        target.textContent = ${JSON.stringify(editedText)};
        target.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof target.blur === 'function') target.blur();
        target.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        return true;
      })()`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )

    await waitFor('text edit persisted to deck HTML', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html.includes(editedText) ? deck : null
    })

    const textEditVersion = await waitForNewestVersion(
      apiPort,
      deckId,
      (version) =>
        version.source === 'manual' &&
        Boolean(version.provenance?.operations?.includes('replace_text')),
      'text-edit version provenance',
    )
    assertManualPatchProvenance(textEditVersion, ['replace_text'])

    await clickToolbarButton(cdp, 'Undo')
    await waitFor('undo restored original heading text', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return !deck.html.includes(editedText) && deck.html.includes('Quarterly planning')
        ? deck
        : null
    })
    const undoTextVersion = await waitForNewestVersion(
      apiPort,
      deckId,
      (version) => Boolean(version.summary?.startsWith('Undo:')),
      'undo text-edit version',
    )
    assertUndoRedoVersion(undoTextVersion, 'undo')

    await clickToolbarButton(cdp, 'Redo')
    await waitFor('redo restored edited heading text', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html.includes(editedText) ? deck : null
    })
    const redoTextVersion = await waitForNewestVersion(
      apiPort,
      deckId,
      (version) => Boolean(version.summary?.startsWith('Redo:')),
      'redo text-edit version',
    )
    assertUndoRedoVersion(redoTextVersion, 'redo')

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
    ))

    // --- Insert text box via bridge postMessage from the sandbox context ---
    const beforeInsertHtml = (await fetchDeck(apiPort, deckId)).html
    await evaluate<boolean>(
      cdp,
      `(() => {
        window.parent.postMessage({
          type: 'ark:editor-insert-request',
          kind: 'text-box',
          slideIndex: 0,
          geometry: { x: 0.12, y: 0.62, width: 0.34, height: 0.1 },
        }, '*');
        return true;
      })()`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )

    const afterInsert = await waitFor('inserted text box in deck HTML', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html !== beforeInsertHtml && deck.html.includes('ark-text-box') ? deck : null
    })

    const insertVersion = await waitForNewestVersion(
      apiPort,
      deckId,
      (version) =>
        version.source === 'manual' &&
        Boolean(version.provenance?.operations?.includes('insert_element')),
      'insert-element version provenance',
    )
    assertManualPatchProvenance(insertVersion, ['insert_element'])

    await clickToolbarButton(cdp, 'Undo')
    await waitFor('undo removed inserted text box', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return !deck.html.includes('ark-text-box') ? deck : null
    })
    assertUndoRedoVersion(
      await waitForNewestVersion(
        apiPort,
        deckId,
        (version) => Boolean(version.summary?.startsWith('Undo:')),
        'undo insert version',
      ),
      'undo',
    )

    await clickToolbarButton(cdp, 'Redo')
    const afterInsertRedo = await waitFor('redo restored inserted text box', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html.includes('ark-text-box') ? deck : null
    })
    assertUndoRedoVersion(
      await waitForNewestVersion(
        apiPort,
        deckId,
        (version) => Boolean(version.summary?.startsWith('Redo:')),
        'redo insert version',
      ),
      'redo',
    )

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
    ))

    const textBoxIdMatch = afterInsertRedo.html.match(/data-ark-id="([^"]+)"/)
    assert(textBoxIdMatch?.[1], 'Inserted text box is missing data-ark-id')
    const textBoxElementId = textBoxIdMatch[1]

    // --- Move/resize via bridge transform-commit ---
    const beforeTransformHtml = (await fetchDeck(apiPort, deckId)).html
    await evaluate<boolean>(
      cdp,
      `(() => {
        window.parent.postMessage({
          type: 'ark:editor-transform-commit',
          elementId: ${JSON.stringify(textBoxElementId)},
          slideIndex: 0,
          geometry: { x: 0.2, y: 0.7, width: 0.4, height: 0.14 },
        }, '*');
        return true;
      })()`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )

    await waitFor('transform persisted to deck HTML', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html !== beforeTransformHtml ? deck : null
    })

    const transformVersion = await waitForNewestVersion(
      apiPort,
      deckId,
      (version) =>
        version.source === 'manual' &&
        Boolean(
          version.provenance?.operations?.includes('move_element') ||
          version.provenance?.operations?.includes('resize_element'),
        ),
      'transform version provenance',
    )
    assertManualPatchProvenance(transformVersion, [])
    assert(
      transformVersion.provenance?.operations?.includes('move_element') ||
        transformVersion.provenance?.operations?.includes('resize_element'),
      `Expected move/resize ops, got ${JSON.stringify(transformVersion.provenance?.operations)}`,
    )

    await clickToolbarButton(cdp, 'Undo')
    await waitFor('undo restored pre-transform HTML', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html === beforeTransformHtml ? deck : null
    })
    assertUndoRedoVersion(
      await waitForNewestVersion(
        apiPort,
        deckId,
        (version) => Boolean(version.summary?.startsWith('Undo:')),
        'undo transform version',
      ),
      'undo',
    )

    await clickToolbarButton(cdp, 'Redo')
    await waitFor('redo restored transform HTML', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html !== beforeTransformHtml ? deck : null
    })
    assertUndoRedoVersion(
      await waitForNewestVersion(
        apiPort,
        deckId,
        (version) => Boolean(version.summary?.startsWith('Redo:')),
        'redo transform version',
      ),
      'redo',
    )

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
    ))

    // --- Delete: select via shell→iframe bridge, then Delete keydown in the
    // sandbox context (same path as the editor keyboard handler). ---
    const beforeDeleteHtml = (await fetchDeck(apiPort, deckId)).html
    await evaluate<boolean>(
      cdp,
      `(() => {
        const iframe = document.querySelector('iframe[title="Generated Ark presentation preview"]');
        if (!iframe || !iframe.contentWindow) return false;
        iframe.contentWindow.postMessage({
          type: 'ark:editor-select',
          elementId: ${JSON.stringify(textBoxElementId)},
          slideIndex: 0,
        }, '*');
        return true;
      })()`,
    )

    await waitFor('text box selected in edit toolbar', async () =>
      evaluate<boolean>(
        cdp!,
        `(() => {
          const button = document.querySelector('button[aria-label="Delete selected element"]');
          return Boolean(button && !button.disabled);
        })()`,
      ),
    )

    await evaluate<boolean>(
      cdp,
      `(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Delete',
          bubbles: true,
          cancelable: true,
        }));
        return true;
      })()`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )

    await waitFor('delete removed text box from deck HTML', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html !== beforeDeleteHtml &&
        !deck.html.includes(`data-ark-id="${textBoxElementId}"`)
        ? deck
        : null
    })

    const deleteVersion = await waitForNewestVersion(
      apiPort,
      deckId,
      (version) =>
        version.source === 'manual' &&
        Boolean(version.provenance?.operations?.includes('delete_element')),
      'delete-element version provenance',
    )
    assertManualPatchProvenance(deleteVersion, ['delete_element'])

    await clickToolbarButton(cdp, 'Undo')
    await waitFor('undo restored deleted text box', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html.includes(`data-ark-id="${textBoxElementId}"`) ? deck : null
    })
    assertUndoRedoVersion(
      await waitForNewestVersion(
        apiPort,
        deckId,
        (version) => Boolean(version.summary?.startsWith('Undo:')),
        'undo delete version',
      ),
      'undo',
    )

    await clickToolbarButton(cdp, 'Redo')
    await waitFor('redo re-deleted text box', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return !deck.html.includes(`data-ark-id="${textBoxElementId}"`) ? deck : null
    })
    assertUndoRedoVersion(
      await waitForNewestVersion(
        apiPort,
        deckId,
        (version) => Boolean(version.summary?.startsWith('Redo:')),
        'redo delete version',
      ),
      'redo',
    )

    // Final sanity: baseline title still present, and we created multiple versions.
    const finalDeck = await fetchDeck(apiPort, deckId)
    assert(finalDeck.title.includes('Plain CSS Deck'), 'Deck title should remain intact')
    assert(finalDeck.html.includes(editedText), 'Final deck should keep the redone text edit')
    const versions = await fetchVersions(apiPort, deckId)
    assert(versions.length >= 9, `Expected many manual versions, found ${versions.length}`)
    assert(
      versions.every((version) => version.source === 'manual' || version.source === 'upload'),
      'Unexpected non-manual/upload version sources in smoke run',
    )

    void afterInsert
    void baseline
    console.log('Manual edit undo/redo browser smoke passed.')
  } catch (error: unknown) {
    await writeBrowserSmokeArtifacts({
      label: 'manual-edit',
      artifactsRoot,
      browser,
      cdp,
      appOrigin: servers?.appOrigin ?? null,
      mainPreviewSrc,
      error,
    })
    throw error
  } finally {
    cdp?.close()
    await stopChromium(browser)

    if (servers) {
      await stopServers(servers)
    }

    await rm(tempRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 250 })
  }
}

runSmoke().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

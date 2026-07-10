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

const manualEditFixturePath = path.join(repoRoot, 'test/fixtures/manual-edit-deck.html')

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
  const body = (await response.json()) as { decks: Array<{ id: string; title: string }> }
  assert(Array.isArray(body.decks), 'GET /api/decks did not return a decks array')
  return body.decks
}

async function fetchDeck(apiPort: number, deckId: string) {
  const response = await fetch(
    `http://127.0.0.1:${apiPort}/api/decks/${encodeURIComponent(deckId)}`,
  )
  assert(response.ok, `GET /api/decks/${deckId} failed: ${response.status}`)
  const body = (await response.json()) as { deck: StoredDeck }
  assert(body.deck?.id, `GET /api/decks/${deckId} did not return a deck`)
  return body.deck
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
    evaluate<boolean>(cdp!, `Boolean(document.querySelector('script[data-ark-preview-editor]'))`, {
      contextId: editPreview.id,
      sessionId: editPreview.sessionId,
    }),
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
  expectedSlideText = 'Quarterly planning',
) {
  return waitFor(
    'refreshed editor sandbox preview',
    async () => {
      const src = await evaluate<string>(
        cdp!,
        `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
      )

      if (!src.startsWith(`${servers.sandboxOrigin}/render/`)) {
        return null
      }

      if (previousSrc && src === previousSrc) {
        return null
      }

      const context = await findContextByUrl(cdp!, contexts, src)
      if (!context) {
        return null
      }

      const loading = await evaluate<boolean>(
        cdp!,
        `document.body.innerText.includes('Loading sandbox preview')`,
      )

      if (loading) {
        return null
      }

      const ready = await evaluate<boolean>(
        cdp!,
        `(() => {
          if (!document.querySelector('script[data-ark-preview-editor]')) return false;
          const active = document.querySelector('section.slide.active, section.slide.is-active');
          return Boolean(active && (active.textContent || '').includes(${JSON.stringify(expectedSlideText)}));
        })()`,
        { contextId: context.id, sessionId: context.sessionId },
      )

      return ready ? { editPreviewSrc: src, editPreview: context } : null
    },
    { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
  )
}

async function getCurrentEditPreview(
  cdp: Awaited<ReturnType<typeof createPage>>,
  servers: { sandboxOrigin: string },
  contexts: Map<string, RuntimeContext>,
) {
  const editPreviewSrc = await waitFor(
    'current editor sandbox preview iframe src',
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
    'current editor sandbox preview frame context',
    () => findContextByUrl(cdp!, contexts, editPreviewSrc),
    { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
  )

  await waitFor('editor bridge script in current preview', async () =>
    evaluate<boolean>(cdp!, `Boolean(document.querySelector('script[data-ark-preview-editor]'))`, {
      contextId: editPreview.id,
      sessionId: editPreview.sessionId,
    }),
  )

  return { editPreviewSrc, editPreview }
}

async function dispatchPointerSequence(
  cdp: Awaited<ReturnType<typeof createPage>>,
  editPreview: RuntimeContext,
  steps: Array<{
    type: 'pointerdown' | 'pointermove' | 'pointerup'
    selector: string
    offsetX?: number
    offsetY?: number
    pointerId?: number
  }>,
) {
  for (const step of steps) {
    const dispatched = await evaluate<boolean>(
      cdp,
      `(() => {
        const step = ${JSON.stringify(step)};
        const target = document.querySelector(step.selector);
        if (!target) return false;
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width * (step.offsetX ?? 0.5);
        const y = rect.top + rect.height * (step.offsetY ?? 0.5);
        const common = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          pointerId: step.pointerId ?? 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          clientX: x,
          clientY: y,
        };
        target.dispatchEvent(
          new PointerEvent(step.type, {
            ...common,
            buttons: step.type === 'pointerup' ? 0 : 1,
          }),
        );
        return true;
      })()`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )

    assert(dispatched, `Could not dispatch ${step.type} in edit preview`)

    // Let the editor bridge process the pointer event before the next one.
    // Fixed sleeps are flaky under CI load; wait for two animation frames instead.
    await evaluate(
      cdp,
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )

    if (step.type === 'pointerdown') {
      await waitFor(
        `editor reacted to pointerdown on ${step.selector}`,
        async () =>
          evaluate<boolean>(
            cdp!,
            `(() => {
              const target = document.querySelector(${JSON.stringify(step.selector)});
              if (!target) return false;
              return (
                target.hasAttribute('data-ark-editor-selected') ||
                Boolean(document.querySelector('[data-ark-editor-selected], [data-ark-editor-handle], [data-ark-editor-marquee]'))
              );
            })()`,
            { contextId: editPreview.id, sessionId: editPreview.sessionId },
          ),
        { timeoutMs: 2_000, intervalMs: 25 },
      ).catch(() => undefined)
    }
  }
}

async function moveTextBoxViaPointer(
  cdp: Awaited<ReturnType<typeof createPage>>,
  servers: { sandboxOrigin: string },
  contexts: Map<string, RuntimeContext>,
  apiPort: number,
  deckId: string,
  elementId: string,
) {
  const beforeHtml = (await fetchDeck(apiPort, deckId)).html
  const boxSelector = `[data-ark-id="${elementId}"]`
  // Under CI load a single synthetic drag can miss the editor's move threshold.
  // Retry with progressively larger deltas against a freshly resolved iframe context.
  const dragAttempts: Array<Array<{ offsetX: number; offsetY: number }>> = [
    [
      { offsetX: 0.35, offsetY: 0.35 },
      { offsetX: 0.75, offsetY: 0.8 },
    ],
    [
      { offsetX: 0.25, offsetY: 0.25 },
      { offsetX: 0.85, offsetY: 0.85 },
    ],
    [
      { offsetX: 0.2, offsetY: 0.3 },
      { offsetX: 0.9, offsetY: 0.7 },
    ],
  ]
  const perAttemptTimeoutMs = Math.max(
    8_000,
    Math.floor(SMOKE_SLOW_TIMEOUT_MS / dragAttempts.length),
  )
  let lastError: unknown

  for (const [start, end] of dragAttempts) {
    const { editPreview } = await getCurrentEditPreview(cdp, servers, contexts)
    await waitFor('text box present in edit preview before drag', async () =>
      evaluate<boolean>(cdp!, `Boolean(document.querySelector(${JSON.stringify(boxSelector)}))`, {
        contextId: editPreview.id,
        sessionId: editPreview.sessionId,
      }),
    )

    await dispatchPointerSequence(cdp, editPreview, [
      { type: 'pointerdown', selector: boxSelector, ...start },
      { type: 'pointermove', selector: boxSelector, ...end },
      { type: 'pointerup', selector: boxSelector, ...end },
    ])

    try {
      return await waitFor(
        'moved text box persisted to deck HTML',
        async () => {
          const deck = await fetchDeck(apiPort, deckId)
          return deck.html !== beforeHtml && deck.html.includes(`data-ark-id="${elementId}"`)
            ? deck
            : null
        },
        { timeoutMs: perAttemptTimeoutMs },
      )
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Timed out waiting for moved text box persisted to deck HTML.')
}

async function deleteTextBoxViaKeyboard(
  cdp: Awaited<ReturnType<typeof createPage>>,
  servers: { sandboxOrigin: string },
  contexts: Map<string, RuntimeContext>,
  apiPort: number,
  deckId: string,
  elementId: string,
) {
  const beforeHtml = (await fetchDeck(apiPort, deckId)).html
  const { editPreview } = await getCurrentEditPreview(cdp, servers, contexts)
  const boxSelector = `[data-ark-id="${elementId}"]`

  await waitFor('text box present before delete', async () =>
    evaluate<boolean>(cdp!, `Boolean(document.querySelector(${JSON.stringify(boxSelector)}))`, {
      contextId: editPreview.id,
      sessionId: editPreview.sessionId,
    }),
  )

  // Click to select the managed element, then Delete to request removal.
  await dispatchPointerSequence(cdp, editPreview, [
    { type: 'pointerdown', selector: boxSelector, offsetX: 0.5, offsetY: 0.5 },
    { type: 'pointerup', selector: boxSelector, offsetX: 0.5, offsetY: 0.5 },
  ])

  await waitFor('text box selected in edit preview', async () =>
    evaluate<boolean>(
      cdp!,
      `Boolean(document.querySelector(${JSON.stringify(`${boxSelector}[data-ark-editor-selected]`)}))`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    ),
  )

  await clickToolbarButton(cdp, 'Delete selected element')

  return waitFor(
    'deleted text box from deck HTML',
    async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html !== beforeHtml && !deck.html.includes(`data-ark-id="${elementId}"`)
        ? deck
        : null
    },
    { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
  )
}

async function insertTextBoxViaTool(
  cdp: Awaited<ReturnType<typeof createPage>>,
  servers: { sandboxOrigin: string },
  contexts: Map<string, RuntimeContext>,
  apiPort: number,
  deckId: string,
) {
  const beforeHtml = (await fetchDeck(apiPort, deckId)).html

  await evaluate<boolean>(
    cdp,
    `Boolean(document.querySelector('button[aria-label="Text box"]')?.click())`,
  )

  await waitFor('text box tool active', async () =>
    evaluate<boolean>(
      cdp!,
      `document.querySelector('button[aria-label="Text box"]')?.getAttribute('aria-pressed') === 'true'`,
    ),
  )

  const { editPreview } = await getCurrentEditPreview(cdp, servers, contexts)

  // Click (no drag) on the active slide — the editor bridge treats this as a
  // default-sized text-box insert and posts ark:editor-insert-request itself.
  await evaluate<boolean>(
    cdp,
    `(() => {
      const slide = document.querySelector('section.slide.active, section.slide.is-active');
      if (!slide) return false;
      const rect = slide.getBoundingClientRect();
      const x = rect.left + rect.width * 0.55;
      const y = rect.top + rect.height * 0.7;
      const common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y,
      };
      slide.dispatchEvent(new PointerEvent('pointerdown', { ...common, buttons: 1 }));
      slide.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
      return true;
    })()`,
    { contextId: editPreview.id, sessionId: editPreview.sessionId },
  )

  return waitFor(
    'inserted text box in deck HTML',
    async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html !== beforeHtml && deck.html.includes('ark-text-box') ? deck : null
    },
    { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
  )
}

async function clickToolbarButton(
  cdp: Awaited<ReturnType<typeof createPage>>,
  label: 'Undo' | 'Redo' | 'Delete selected element',
) {
  await waitFor(`click ${label} toolbar button`, async () =>
    evaluate<boolean>(
      cdp!,
      `(() => {
        const button = document.querySelector('button[aria-label="${label}"]');
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`,
    ),
  )
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
  assert(existsSync(manualEditFixturePath), `Missing fixture ${manualEditFixturePath}`)

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
    // Desktop layout wires onPatchEditorOperations; keep the smoke above the
    // lg breakpoint so insert/transform/delete go through the same path as
    // production desktop editing.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

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
    await setUploadFile(cdp, manualEditFixturePath)

    await waitFor(
      'uploaded manual-edit deck in shell',
      async () => {
        const text = await evaluate<string>(cdp!, 'document.body.innerText')
        return text.includes('Manual Edit Deck') && text.includes('Slide 1 of 3')
      },
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )

    const decks = await waitFor('uploaded deck in API', async () => {
      const listed = await listDecks(apiPort)
      return listed.find((deck) => deck.title.includes('Manual Edit Deck')) ?? null
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

    // Order: insert → transform → delete on the fresh edit-mode iframe, then
    // text edit. Undo/redo after each op reloads the preview; doing structural
    // bridge ops first avoids racing a stale iframe after text undo/redo.
    const afterInsert = await insertTextBoxViaTool(cdp, servers, contexts, apiPort, deckId)

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
      'Quarterly planning',
    ))

    const textBoxIdMatch = afterInsertRedo.html.match(
      /class="[^"]*ark-text-box[^"]*"[^>]*data-ark-id="([^"]+)"|data-ark-id="([^"]+)"[^>]*class="[^"]*ark-text-box[^"]*"/,
    )
    const textBoxElementId = textBoxIdMatch?.[1] || textBoxIdMatch?.[2]
    assert(textBoxElementId, 'Inserted text box is missing data-ark-id')

    // Ensure select tool is active before drag/delete (insert may leave text-box pressed briefly).
    await evaluate<boolean>(
      cdp,
      `Boolean(document.querySelector('button[aria-label="Select"]')?.click())`,
    )
    await waitFor('select tool active before transform', async () =>
      evaluate<boolean>(
        cdp!,
        `document.querySelector('button[aria-label="Select"]')?.getAttribute('aria-pressed') === 'true'`,
      ),
    )

    const beforeTransformHtml = (await fetchDeck(apiPort, deckId)).html
    await moveTextBoxViaPointer(cdp, servers, contexts, apiPort, deckId, textBoxElementId)

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
      'Quarterly planning',
    ))

    await evaluate<boolean>(
      cdp,
      `Boolean(document.querySelector('button[aria-label="Select"]')?.click())`,
    )
    await waitFor('select tool active before delete', async () =>
      evaluate<boolean>(
        cdp!,
        `document.querySelector('button[aria-label="Select"]')?.getAttribute('aria-pressed') === 'true'`,
      ),
    )

    await deleteTextBoxViaKeyboard(cdp, servers, contexts, apiPort, deckId, textBoxElementId)

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

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      'Quarterly planning',
    ))

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
    assertUndoRedoVersion(
      await waitForNewestVersion(
        apiPort,
        deckId,
        (version) => Boolean(version.summary?.startsWith('Undo:')),
        'undo text-edit version',
      ),
      'undo',
    )

    await clickToolbarButton(cdp, 'Redo')
    await waitFor('redo restored edited heading text', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html.includes(editedText) ? deck : null
    })
    assertUndoRedoVersion(
      await waitForNewestVersion(
        apiPort,
        deckId,
        (version) => Boolean(version.summary?.startsWith('Redo:')),
        'redo text-edit version',
      ),
      'redo',
    )

    const finalDeck = await fetchDeck(apiPort, deckId)
    assert(finalDeck.title.includes('Manual Edit Deck'), 'Deck title should remain intact')
    assert(finalDeck.html.includes(editedText), 'Final deck should keep the redone text edit')
    assert(
      !finalDeck.html.includes(`data-ark-id="${textBoxElementId}"`),
      'Text box should stay deleted',
    )
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
    try {
      cdp?.close()
    } catch {
      // Ignore teardown races once assertions have finished.
    }

    await stopChromium(browser).catch(() => undefined)

    if (servers) {
      await stopServers(servers).catch(() => undefined)
    }

    await rm(tempRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 250 })
  }
}

runSmoke().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

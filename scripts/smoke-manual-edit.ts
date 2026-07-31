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
const revealFixturePath = path.join(repoRoot, 'test/fixtures/reveal-vertical-deck.html')
const hostileEditorFixturePath = path.join(
  repoRoot,
  'test/fixtures/hostile-editor-postmessage-deck.html',
)

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
  await waitFor('always-on edit mode toolbar', async () =>
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
    evaluate<boolean>(cdp!, `Boolean(document.querySelector('style[data-ark-editor="true"]'))`, {
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
  expectedLifecycle: 'reload' | 'reuse' = 'reload',
  previousContext: RuntimeContext | null = null,
) {
  let lastState = 'not polled'

  try {
    return await waitFor(
      'refreshed editor sandbox preview',
      async () => {
        const src = await evaluate<string>(
          cdp!,
          `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
        )

        if (!src.startsWith(`${servers.sandboxOrigin}/render/`)) {
          lastState = `unexpected URL: ${src || '(missing)'}`
          return null
        }

        if (
          previousSrc &&
          expectedLifecycle === 'reload' &&
          src === previousSrc &&
          !previousContext
        ) {
          lastState = 'waiting for a new iframe URL'
          return null
        }

        if (previousSrc && expectedLifecycle === 'reuse' && src !== previousSrc) {
          lastState = `iframe unexpectedly reloaded: ${previousSrc} → ${src}`
          return null
        }

        const exact = await findContextByUrl(cdp!, contexts, src)
        const candidates = [
          ...(expectedLifecycle === 'reuse' && previousContext ? [previousContext] : []),
          ...[...contexts.values()].reverse().filter((context) => context.isDefault),
          exact,
        ].filter((context): context is RuntimeContext => Boolean(context))
        const seenContexts = new Set<string>()
        const context = await (async () => {
          for (const candidate of candidates) {
            const key = `${candidate.sessionId ?? 'root'}:${candidate.id}`

            if (seenContexts.has(key)) {
              continue
            }
            seenContexts.add(key)

            if (
              expectedLifecycle === 'reload' &&
              previousContext &&
              candidate.id === previousContext.id &&
              candidate.sessionId === previousContext.sessionId
            ) {
              continue
            }

            const href = await evaluate<string>(cdp!, 'location.href', {
              contextId: candidate.id,
              sessionId: candidate.sessionId,
            }).catch(() => '')

            if (href === src) {
              return candidate
            }
          }

          return null
        })()

        if (!context) {
          lastState = `no execution context for ${src}`
          return null
        }

        const readiness = await evaluate<{ activeText: string; hasRuntime: boolean }>(
          cdp!,
          `(() => {
          const active = document.querySelector('section.slide.active, section.slide.is-active');
          return {
            activeText: active?.textContent || '',
            hasRuntime: Boolean(document.querySelector('style[data-ark-editor="true"]')),
          };
        })()`,
          { contextId: context.id, sessionId: context.sessionId },
        )
        const ready = readiness.hasRuntime && readiness.activeText.includes(expectedSlideText)
        lastState = `runtime=${readiness.hasRuntime}, active=${JSON.stringify(readiness.activeText.slice(0, 80))}`

        if (!ready) return null

        await new Promise((resolve) => setTimeout(resolve, 500))
        const stableSrc = await evaluate<string>(
          cdp!,
          `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
        )
        const stableContextSrc = await evaluate<string>(cdp!, 'location.href', {
          contextId: context.id,
          sessionId: context.sessionId,
        }).catch(() => '')

        return stableSrc === src && stableContextSrc === src
          ? { editPreviewSrc: src, editPreview: context }
          : null
      },
      { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
    )
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Last state: ${lastState}`,
      { cause: error },
    )
  }
}

async function getCurrentEditPreview(
  cdp: Awaited<ReturnType<typeof createPage>>,
  servers: { sandboxOrigin: string },
  contexts: Map<string, RuntimeContext>,
  requiredSelector = 'style[data-ark-editor="true"]',
  previousSrc = '',
) {
  return waitFor(
    'current ready editor sandbox preview',
    async () => {
      const src = await evaluate<string>(
        cdp!,
        `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
      )

      if (!src.startsWith(`${servers.sandboxOrigin}/render/`) || src === previousSrc) {
        return null
      }

      const exact = await findContextByUrl(cdp!, contexts, src)
      const candidates = [
        exact,
        ...[...contexts.values()].reverse().filter((context) => context.isDefault),
      ].filter((context): context is RuntimeContext => Boolean(context))

      for (const editPreview of candidates) {
        const state = await evaluate<{ href: string; ready: boolean }>(
          cdp!,
          `({
            href: location.href,
            ready: Boolean(document.querySelector('style[data-ark-editor="true"]')) && Boolean(document.querySelector(${JSON.stringify(requiredSelector)})),
          })`,
          { contextId: editPreview.id, sessionId: editPreview.sessionId },
        ).catch(() => null)

        if (state?.ready && state.href === src) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          const stableSrc = await evaluate<string>(
            cdp!,
            `document.querySelector('iframe[title="Generated Ark presentation preview"]')?.src || ''`,
          )
          const stableContextSrc = await evaluate<string>(cdp!, 'location.href', {
            contextId: editPreview.id,
            sessionId: editPreview.sessionId,
          }).catch(() => '')

          if (stableSrc === src && stableContextSrc === src) {
            return { editPreviewSrc: state.href, editPreview }
          }
        }
      }

      return null
    },
    { timeoutMs: SMOKE_SLOW_TIMEOUT_MS },
  )
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

async function getElementRect(
  cdp: Awaited<ReturnType<typeof createPage>>,
  context: RuntimeContext,
  selector: string,
) {
  return evaluate<{ left: number; top: number; width: number; height: number } | null>(
    cdp,
    `(() => {
      const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    })()`,
    { contextId: context.id, sessionId: context.sessionId },
  )
}

async function cancelPendingNudgeViaUndo(
  cdp: Awaited<ReturnType<typeof createPage>>,
  context: RuntimeContext,
  selector: string,
) {
  const alreadySelected = await evaluate<boolean>(
    cdp,
    `document.querySelector(${JSON.stringify(selector)})?.hasAttribute('data-ark-editor-selected') === true`,
    { contextId: context.id, sessionId: context.sessionId },
  )

  if (!alreadySelected) {
    await dispatchPointerSequence(cdp, context, [
      { type: 'pointerdown', selector },
      { type: 'pointerup', selector },
    ])
  }

  await waitFor('heading selected before nudge', async () =>
    evaluate<boolean>(
      cdp,
      `document.querySelector(${JSON.stringify(selector)})?.hasAttribute('data-ark-editor-selected') === true`,
      { contextId: context.id, sessionId: context.sessionId },
    ),
  )
  await evaluate(
    cdp,
    `(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      return new Promise((resolve) => setTimeout(resolve, 1000));
    })()`,
    { contextId: context.id, sessionId: context.sessionId },
  )
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

  await evaluate<boolean>(
    cdp,
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))`,
    { contextId: editPreview.id, sessionId: editPreview.sessionId },
  )

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
  label: 'Undo' | 'Redo',
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
        const slideOneActive = await evaluate<boolean>(
          cdp!,
          `Boolean(document.querySelector('button[aria-label="Go to slide 1"][aria-current="true"]'))`,
        )
        return text.includes('Manual Edit Deck') && slideOneActive
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

    const headingSelector = '[data-ark-id="ark-el-title"]'
    const initialVersionCount = (await fetchVersions(apiPort, deckId)).length
    await cancelPendingNudgeViaUndo(cdp, editPreview, headingSelector)
    assert(
      (await fetchDeck(apiPort, deckId)).html === baseline.html,
      'Immediate undo should cancel an unmanaged nudge without persisting',
    )
    assert(
      (await fetchVersions(apiPort, deckId)).length === initialVersionCount,
      'Immediate undo should not create a version when history is empty',
    )
    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(cdp, servers, contexts, ''))
    const originalHeadingRect = await getElementRect(cdp, editPreview, headingSelector)
    assert(originalHeadingRect, 'Unmanaged heading is missing before adoption')
    const originalHeadingStyle = await evaluate<{ color: string; fontSize: string }>(
      cdp,
      `(() => {
        const style = getComputedStyle(document.querySelector(${JSON.stringify(headingSelector)}));
        return { color: style.color, fontSize: style.fontSize };
      })()`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )
    const frameRect = await evaluate<{ left: number; top: number; width: number; height: number }>(
      cdp,
      `(() => {
        const rect = document.querySelector('iframe[title="Generated Ark presentation preview"]')?.getBoundingClientRect();
        return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
      })()`,
    )
    assert(frameRect, 'Edit preview iframe is missing before adoption')
    const frameViewport = await evaluate<{ width: number; height: number }>(
      cdp,
      `({ width: window.innerWidth, height: window.innerHeight })`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )
    const startX =
      frameRect.left +
      (originalHeadingRect.left + originalHeadingRect.width / 2) *
        (frameRect.width / frameViewport.width)
    const startY =
      frameRect.top +
      (originalHeadingRect.top + originalHeadingRect.height / 2) *
        (frameRect.height / frameViewport.height)
    const outsideX = Math.max(1, frameRect.left - 20)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: startX,
      y: startY,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: startX - 30,
      y: startY,
      button: 'left',
      buttons: 1,
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: outsideX,
      y: startY,
      button: 'left',
      buttons: 1,
    })
    await evaluate(
      cdp,
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )
    let liveAdoptedRect = await getElementRect(cdp, editPreview, headingSelector)
    assert(liveAdoptedRect, 'Adopted heading is missing before commit')
    assert(
      Math.abs(liveAdoptedRect.left - originalHeadingRect.left) > 1 ||
        Math.abs(liveAdoptedRect.top - originalHeadingRect.top) > 1,
      'Heading did not move during adoption',
    )
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: outsideX,
      y: startY,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    const outsideCommit = await waitFor(
      'outside drag commit or cancellation',
      async () => {
        const deck = await fetchDeck(apiPort, deckId)

        if (deck.html !== baseline.html) {
          return deck
        }

        const rect = await getElementRect(cdp, editPreview, headingSelector)

        if (
          rect &&
          Math.abs(rect.left - originalHeadingRect.left) <= 1 &&
          Math.abs(rect.top - originalHeadingRect.top) <= 1 &&
          Math.abs(rect.width - originalHeadingRect.width) <= 1 &&
          Math.abs(rect.height - originalHeadingRect.height) <= 1
        ) {
          return false
        }

        return null
      },
      { timeoutMs: 2_000, intervalMs: 50 },
    ).catch(() => null)

    if (!outsideCommit) {
      const restoredRect = await getElementRect(cdp, editPreview, headingSelector)
      assert(restoredRect, 'Heading is missing after outside drag cancellation')
      for (const axis of ['left', 'top', 'width', 'height'] as const) {
        assert(
          Math.abs(restoredRect[axis] - originalHeadingRect[axis]) <= 1,
          `Outside release left heading ${axis} stuck at ${restoredRect[axis]}`,
        )
      }

      const endX = startX + 30
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: startX,
        y: startY,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: endX,
        y: startY,
        button: 'left',
        buttons: 1,
      })
      await evaluate(
        cdp,
        `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
        { contextId: editPreview.id, sessionId: editPreview.sessionId },
      )
      liveAdoptedRect = await getElementRect(cdp, editPreview, headingSelector)
      assert(liveAdoptedRect, 'Adopted heading is missing before in-frame commit')
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: endX,
        y: startY,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      })
    }

    await waitFor('adopted heading persisted', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html.includes('data-ark-id="ark-el-title"') &&
        deck.html.includes('data-ark-managed="true"')
        ? deck
        : null
    })

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      'Quarterly planning',
      'reuse',
      editPreview,
    ))
    const persistedHeadingRect = await getElementRect(cdp, editPreview, headingSelector)
    assert(persistedHeadingRect, 'Adopted heading is missing after persistence')
    for (const axis of ['left', 'top', 'width', 'height'] as const) {
      assert(
        Math.abs(persistedHeadingRect[axis] - liveAdoptedRect[axis]) <= 1,
        `Adopted heading ${axis} drifted after persistence: ${liveAdoptedRect[axis]} → ${persistedHeadingRect[axis]}`,
      )
    }
    await waitFor('adopted heading selection restored', async () =>
      evaluate<boolean>(
        cdp!,
        `Boolean(document.querySelector(${JSON.stringify(headingSelector)})?.hasAttribute('data-ark-editor-selected'))`,
        { contextId: editPreview.id, sessionId: editPreview.sessionId },
      ),
    )
    const persistedHeadingState = await evaluate<{
      color: string
      fontSize: string
      position: string
      width: string
      parentClass: string
      selected: boolean
    }>(
      cdp,
      `(() => {
        const heading = document.querySelector(${JSON.stringify(headingSelector)});
        const style = getComputedStyle(heading);
        return {
          color: style.color,
          fontSize: style.fontSize,
          position: heading?.style.position || '',
          width: heading?.style.width || '',
          parentClass: heading?.parentElement?.className || '',
          selected: Boolean(heading?.hasAttribute('data-ark-editor-selected')),
        };
      })()`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )
    assert(
      persistedHeadingState.color === originalHeadingStyle.color &&
        persistedHeadingState.fontSize === originalHeadingStyle.fontSize,
      'Nested adoption changed inherited/scoped heading styles',
    )
    assert(
      persistedHeadingState.parentClass.includes('positioned-title'),
      'Nested adoption changed the heading parent',
    )
    assert(
      persistedHeadingState.position === 'absolute' && persistedHeadingState.width.endsWith('px'),
      'Adoption did not persist absolute positioning and measured width',
    )
    assert(
      persistedHeadingState.selected,
      'Adopted heading selection was not preserved after persistence',
    )
    await waitFor('dark-surface selection uses white chrome', async () =>
      evaluate<boolean>(
        cdp!,
        `Boolean(document.querySelector('.pointer-events-none.border-white'))`,
      ),
    )

    const adoptedHtml = (await fetchDeck(apiPort, deckId)).html
    const adoptedVersionCount = (await fetchVersions(apiPort, deckId)).length
    await cancelPendingNudgeViaUndo(cdp, editPreview, headingSelector)
    assert(
      (await fetchDeck(apiPort, deckId)).html === adoptedHtml,
      'Immediate undo should cancel a managed nudge without undoing prior history',
    )
    assert(
      (await fetchVersions(apiPort, deckId)).length === adoptedVersionCount,
      'Immediate undo should not create or undo a version when history is non-empty',
    )

    const beforeCommittedNudge = (await fetchDeck(apiPort, deckId)).html
    await evaluate<boolean>(
      cdp,
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`,
      { contextId: editPreview.id, sessionId: editPreview.sessionId },
    )
    await waitFor('arrow nudge persisted', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html !== beforeCommittedNudge ? deck : null
    })
    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      'Quarterly planning',
      'reuse',
      editPreview,
    ))
    await clickToolbarButton(cdp, 'Undo')
    await waitFor('undo restored pre-nudge HTML', async () => {
      const deck = await fetchDeck(apiPort, deckId)
      return deck.html === beforeCommittedNudge ? deck : null
    })
    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
    ))

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

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      'Quarterly planning',
    ))

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

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      'Quarterly planning',
    ))

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

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      'Quarterly planning',
      'reuse',
      editPreview,
    ))

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

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      'Quarterly planning',
      'reload',
      editPreview,
    ))

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

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      'Quarterly planning',
    ))

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

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      'Quarterly planning',
    ))

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

    // --- Second-click text edit via real pointer events inside the sandbox iframe ---
    const headingSelectorForTextEdit = 'section.slide.active h1, section.slide.is-active h1, h1'
    await dispatchPointerSequence(cdp, editPreview, [
      { type: 'pointerdown', selector: headingSelectorForTextEdit },
      { type: 'pointerup', selector: headingSelectorForTextEdit },
      { type: 'pointerdown', selector: headingSelectorForTextEdit },
      { type: 'pointerup', selector: headingSelectorForTextEdit },
    ])

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
        return !target.hasAttribute('contenteditable') && !target.hasAttribute('data-ark-editor-text-edit');
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

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      editedText,
      'reuse',
      editPreview,
    ))

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

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      'Quarterly planning',
      'reload',
      editPreview,
    ))

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

    ;({ editPreviewSrc, editPreview } = await refreshEditPreviewContext(
      cdp,
      servers,
      contexts,
      editPreviewSrc,
      editedText,
    ))

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

    await setUploadFile(cdp, revealFixturePath)
    await waitFor('uploaded Reveal manual-edit deck in shell', async () => {
      const text = await evaluate<string>(cdp!, 'document.body.innerText')
      const slideOneActive = await evaluate<boolean>(
        cdp!,
        `Boolean(document.querySelector('button[aria-label="Go to slide 1"][aria-current="true"]'))`,
      )
      return text.includes('Reveal Vertical Deck') && slideOneActive
    })
    const revealDeck = await waitFor('uploaded Reveal deck in API', async () => {
      const listed = await listDecks(apiPort)
      return listed.find((deck) => deck.title.includes('Reveal Vertical Deck')) ?? null
    })
    let revealPreview = await getCurrentEditPreview(
      cdp,
      servers,
      contexts,
      'style[data-ark-editor="true"]',
      editPreviewSrc,
    )
    const revealHeadingSelector = '.reveal .slides > section.present > section.present > h2'
    for (const [expectedSlide, expectedHeading] of [
      [2, 'Vertical one'],
      [3, 'Vertical two'],
    ] as const) {
      await evaluate(
        cdp,
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`,
      )
      await waitFor(`Reveal navigated to linear slide ${expectedSlide}`, async () => {
        const text = await evaluate<string>(cdp!, 'document.body.innerText')
        const activeHeading = await evaluate<string>(
          cdp!,
          `document.querySelector(${JSON.stringify(revealHeadingSelector)})?.textContent?.trim() || ''`,
          {
            contextId: revealPreview.editPreview.id,
            sessionId: revealPreview.editPreview.sessionId,
          },
        ).catch(() => '')
        return text.includes(`Slide ${expectedSlide} of 4`) && activeHeading === expectedHeading
      })
      await new Promise((resolve) => setTimeout(resolve, 900))
    }
    await waitFor('Reveal editor ready for selection', async () =>
      evaluate<boolean>(
        cdp!,
        `(() => {
          const target = document.querySelector(${JSON.stringify(revealHeadingSelector)});
          if (!target) return false;
          const rect = target.getBoundingClientRect();
          const init = {
            bubbles: true, cancelable: true, composed: true, pointerId: 7,
            pointerType: 'mouse', isPrimary: true, button: 0,
            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
          };
          target.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
          target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
          return target.hasAttribute('data-ark-editor-selected');
        })()`,
        {
          contextId: revealPreview.editPreview.id,
          sessionId: revealPreview.editPreview.sessionId,
        },
      ).catch(() => false),
    )
    const revealBefore = await getElementRect(cdp, revealPreview.editPreview, revealHeadingSelector)
    assert(revealBefore, 'Reveal heading missing before movement')
    await evaluate<boolean>(
      cdp,
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }))`,
      {
        contextId: revealPreview.editPreview.id,
        sessionId: revealPreview.editPreview.sessionId,
      },
    )
    // Let the runtime correct for Reveal's post-adoption recenter before the
    // 400 ms nudge commit reloads the iframe.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const revealLiveState = await evaluate<{
      rect: { left: number; top: number; width: number; height: number } | null
      style: string
      selected: boolean
    }>(
      cdp,
      `(() => {
        const heading = document.querySelector(${JSON.stringify(revealHeadingSelector)});
        const rect = heading?.getBoundingClientRect();
        return {
          rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
          style: heading?.getAttribute('style') || '',
          selected: Boolean(heading?.hasAttribute('data-ark-editor-selected')),
        };
      })()`,
      {
        contextId: revealPreview.editPreview.id,
        sessionId: revealPreview.editPreview.sessionId,
      },
    )
    const revealLive = revealLiveState.rect
    assert(revealLive, 'Reveal heading missing during movement')
    assert(
      Math.abs(revealLive.left - revealBefore.left) > 1 ||
        Math.abs(revealLive.top - revealBefore.top) > 1,
      `Reveal heading did not move (${JSON.stringify(revealLiveState)})`,
    )
    await waitFor('Reveal movement persisted', async () => {
      const deck = await fetchDeck(apiPort, revealDeck.id)
      return deck.html.includes('data-ark-managed="true"') ? deck : null
    })
    revealPreview = await getCurrentEditPreview(
      cdp,
      servers,
      contexts,
      revealHeadingSelector,
      revealPreview.editPreviewSrc,
    )
    await new Promise((resolve) => setTimeout(resolve, 900))
    const revealPersisted = await getElementRect(
      cdp,
      revealPreview.editPreview,
      revealHeadingSelector,
    )
    assert(revealPersisted, 'Reveal heading missing after movement reload')
    for (const axis of ['left', 'top', 'width', 'height'] as const) {
      assert(
        Math.abs(revealPersisted[axis] - revealLive[axis]) <= 1,
        `Reveal heading ${axis} drifted after persistence: ${revealLive[axis]} → ${revealPersisted[axis]}`,
      )
    }

    await setUploadFile(cdp, hostileEditorFixturePath)
    await waitFor('uploaded hostile full-JS deck with edit chrome', async () => {
      const text = await evaluate<string>(cdp!, 'document.body.innerText')
      return (
        text.includes('Hostile Editor PostMessage Deck') &&
        (await evaluate<boolean>(
          cdp!,
          `Boolean(document.querySelector('button[aria-label="Select"]'))`,
        ))
      )
    })
    const fullJsDeck = await waitFor('uploaded full-JS deck in API', async () => {
      const listed = await listDecks(apiPort)
      return listed.find((deck) => deck.title.includes('Hostile Editor PostMessage Deck')) ?? null
    })
    const fullJsHeadingSelector = 'h1[data-ark-id="ark-el-title"]'
    const fullJsPreview = await getCurrentEditPreview(
      cdp,
      servers,
      contexts,
      fullJsHeadingSelector,
      revealPreview.editPreviewSrc,
    )

    // The fixture posts well-formed forged mutation requests on the public
    // window channel. They must not enter the private editor channel.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const fullJsBefore = await fetchDeck(apiPort, fullJsDeck.id)
    assert(
      fullJsBefore.html.includes('Editor bridge hijack'),
      'Full-JS deck forged a public editor delete request',
    )

    await dispatchPointerSequence(cdp, fullJsPreview.editPreview, [
      { type: 'pointerdown', selector: fullJsHeadingSelector },
      { type: 'pointerup', selector: fullJsHeadingSelector },
    ])
    await waitFor('full-JS heading selected', async () =>
      evaluate<boolean>(
        cdp!,
        `document.querySelector(${JSON.stringify(fullJsHeadingSelector)})?.hasAttribute('data-ark-editor-selected') === true`,
        {
          contextId: fullJsPreview.editPreview.id,
          sessionId: fullJsPreview.editPreview.sessionId,
        },
      ),
    )
    await evaluate(
      cdp,
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`,
      {
        contextId: fullJsPreview.editPreview.id,
        sessionId: fullJsPreview.editPreview.sessionId,
      },
    )
    await waitFor('full-JS nudge persisted through the private editor channel', async () => {
      const deck = await fetchDeck(apiPort, fullJsDeck.id)
      return deck.html !== fullJsBefore.html && deck.html.includes('data-ark-managed="true"')
        ? deck
        : null
    })

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

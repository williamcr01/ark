#!/usr/bin/env node
/**
 * Profile manual-editor drag performance in a real Electron/Chromium session.
 *
 * This is intentionally a developer benchmark rather than a CI test.  Build the
 * desktop app first (`pnpm build`) and run:
 *
 *   pnpm profile:editor-drag
 *   pnpm profile:editor-drag -- --case absolute-500 --runs 5 --output /tmp/ark-profile.json
 *   pnpm profile:editor-drag -- --case absolute-500 --runs 5 --cpu-profile --user-data-dir /path/on/disk
 *
 * The harness uses the Chrome DevTools Protocol over Electron's remote-debugging
 * port (renderer + sandbox iframe) and, when `--cpu-profile` is set, the Node
 * inspector on the Electron main process.  It drives the editor with
 * Input.dispatchMouseEvent and only uses Runtime.evaluate for setup, counters,
 * and the synthetic pointercancel needed to exercise the cancellation invariant
 * (public postMessage is never forged).
 *
 * See docs/editor-drag-profiling.md for storage paths, Chromium artifacts, and
 * how to interpret PATCH phase logs after #308–#313.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = path.join(root, 'apps/desktop')
const electronBinary = path.join(desktop, 'node_modules', '.bin', 'electron')
const revealFixturePath = path.join(root, 'test/fixtures/reveal-registry-deck.html')

const DEFAULT_CASES = ['absolute-100', 'absolute-500', 'reveal-50', 'adoption']
const DEFAULT_RUNS = 3
const DEFAULT_DRAG_STEPS = 12
const DEBUG_PORT = Number(process.env.ARK_PROFILE_CDP_PORT || 0)
const INSPECT_PORT = Number(process.env.ARK_PROFILE_INSPECT_PORT || 0)
const TRACE_CATEGORIES =
  'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.timeline.stack,disabled-by-default-network'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function parseArgs(argv) {
  const options = {
    cases: [...DEFAULT_CASES],
    runs: DEFAULT_RUNS,
    steps: DEFAULT_DRAG_STEPS,
    output: null,
    artifactsDir: null,
    userDataDir: process.env.ARK_PROFILE_USER_DATA_DIR?.trim() || null,
    workspacesDir: process.env.ARK_PROFILE_WORKSPACES_DIR?.trim() || null,
    headed: false,
    keepProfile: false,
    undo: false,
    trace: true,
    cpuProfile: false,
    heapSnapshot: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--case' || arg === '--cases') {
      options.cases = (argv[++index] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    } else if (arg === '--runs') {
      options.runs = Math.max(1, Number(argv[++index] || DEFAULT_RUNS))
    } else if (arg === '--steps') {
      options.steps = Math.max(1, Number(argv[++index] || DEFAULT_DRAG_STEPS))
    } else if (arg === '--output') {
      options.output = argv[++index] || null
    } else if (arg === '--artifacts-dir') {
      options.artifactsDir = argv[++index] || null
    } else if (arg === '--user-data-dir') {
      options.userDataDir = argv[++index] || null
    } else if (arg === '--workspaces-dir') {
      options.workspacesDir = argv[++index] || null
    } else if (arg === '--headed') {
      options.headed = true
    } else if (arg === '--keep-profile') {
      options.keepProfile = true
    } else if (arg === '--undo') {
      options.undo = true
    } else if (arg === '--no-trace') {
      options.trace = false
    } else if (arg === '--cpu-profile') {
      options.cpuProfile = true
    } else if (arg === '--heap-snapshot') {
      options.heapSnapshot = true
    } else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!options.cases.length) throw new Error('At least one --case is required.')
  if (!Number.isInteger(options.runs) || options.runs < 1)
    throw new Error('--runs must be a positive integer.')
  if (!Number.isInteger(options.steps) || options.steps < 1)
    throw new Error('--steps must be a positive integer.')
  return options
}

function printUsage() {
  console.log(`Usage: pnpm profile:editor-drag -- [options]

Options:
  --case <names>       Comma-separated: absolute-100, absolute-500, reveal-50, adoption
  --runs <n>           Warmed runs per case (default: ${DEFAULT_RUNS})
  --steps <n>          Native pointer moves per gesture (default: ${DEFAULT_DRAG_STEPS})
  --output <path>      Write the full JSON report to a file
  --artifacts-dir <path>  Directory for CPU profiles, heap snapshots, and traces
  --user-data-dir <path>  Electron userData (default: tmpdir overlay; set to a real disk)
  --workspaces-dir <path>  .ark persist directory (default: <user-data-dir>/workspaces)
  --headed             Do not wrap Electron in xvfb-run on Linux
  --keep-profile      Keep the Electron user-data directory
  --undo              Exercise Ctrl/Cmd-Z after a committed gesture
  --no-trace           Skip Tracing domain collection (faster, less paint detail)
  --cpu-profile        Capture Chromium + Electron-main V8 CPU profiles per gesture
  --heap-snapshot      Capture renderer/iframe heap snapshots after each commit

Env:
  ARK_PROFILE_USER_DATA_DIR / ARK_PROFILE_WORKSPACES_DIR  same as the path flags
  ARK_PROFILE_CDP_PORT / ARK_PROFILE_INSPECT_PORT         pin debugger ports
  ELECTRON_DISABLE_SANDBOX=1                              needed in some containers
`)
}

function randomPort() {
  if (DEBUG_PORT > 0) return DEBUG_PORT
  return 39_000 + Math.floor(Math.random() * 1_000)
}

function randomInspectPort() {
  if (INSPECT_PORT > 0) return INSPECT_PORT
  return 40_000 + Math.floor(Math.random() * 1_000)
}

function roundMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Number(value.toFixed(3))
}

function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return roundMs(sorted[idx])
}

async function inspectStoragePath(directory) {
  const resolved = path.resolve(directory)
  await mkdir(resolved, { recursive: true })
  let fsType = 'unknown'
  let mount = '/'
  try {
    const mounts = await readFile('/proc/mounts', 'utf8')
    for (const line of mounts.split('\n')) {
      const parts = line.split(/\s+/)
      if (parts.length < 3) continue
      const mountPoint = parts[1]?.replace(/\\040/g, ' ')
      const type = parts[2]
      if (!mountPoint || !type) continue
      const prefix = mountPoint.endsWith('/') ? mountPoint : `${mountPoint}/`
      if (
        resolved === mountPoint ||
        resolved.startsWith(prefix) ||
        `${resolved}/`.startsWith(prefix)
      ) {
        if (mountPoint.length >= mount.length) {
          mount = mountPoint
          fsType = type
        }
      }
    }
  } catch {
    // /proc/mounts is Linux-only; macOS/Windows reports stay "unknown".
  }
  const ephemeral = ['tmpfs', 'overlay', 'ramfs', 'aufs'].includes(fsType)
  return { path: resolved, fsType, mount, ephemeral }
}

function summarizeCpuProfile(profile, topN = 12) {
  if (!profile?.nodes?.length) return null
  const nodes = profile.nodes
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const samples = profile.samples || []
  const timeDeltas = profile.timeDeltas || []
  const selfUs = new Map()
  if (samples.length && timeDeltas.length) {
    for (let index = 0; index < samples.length; index += 1) {
      const nodeId = samples[index]
      const delta = timeDeltas[index] || 0
      selfUs.set(nodeId, (selfUs.get(nodeId) || 0) + delta)
    }
  } else {
    for (const node of nodes) {
      selfUs.set(node.id, (node.hitCount || 0) * 100)
    }
  }
  const idleIds = new Set()
  for (const node of nodes) {
    const name = node.callFrame?.functionName || ''
    if (name === '(idle)' || name === '(program)' || name === '(garbage collector)') {
      idleIds.add(node.id)
    }
  }
  const rows = [...selfUs.entries()]
    .filter(([id, us]) => us > 0 && !idleIds.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id, us]) => {
      const node = byId.get(id)
      const frame = node?.callFrame || {}
      return {
        functionName: frame.functionName || '(anonymous)',
        url: frame.url || '',
        lineNumber: typeof frame.lineNumber === 'number' ? frame.lineNumber : null,
        selfMs: roundMs(us / 1_000),
      }
    })
  const totalUs = [...selfUs.values()].reduce((sum, value) => sum + value, 0)
  const idleUs = [...idleIds].reduce((sum, id) => sum + (selfUs.get(id) || 0), 0)
  return {
    startTime: profile.startTime,
    endTime: profile.endTime,
    durationMs: roundMs(((profile.endTime || 0) - (profile.startTime || 0)) / 1_000),
    sampleCount: samples.length,
    idleMs: roundMs(idleUs / 1_000),
    activeMs: roundMs((totalUs - idleUs) / 1_000),
    top: rows,
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10_000),
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText} from ${url}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    )
  }
  return body
}

async function waitFor(description, predicate, timeoutMs = 20_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`,
  )
}

async function readResponseBodyAsJson(response) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { status: response.status, text }
  }
}

class CdpConnection {
  constructor(url) {
    this.url = url
    this.socket = null
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out connecting to ${this.url}`)),
        10_000,
      )
      this.socket.addEventListener(
        'open',
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
      this.socket.addEventListener(
        'error',
        (event) => {
          clearTimeout(timeout)
          reject(
            new Error(`Could not connect to ${this.url}: ${event.message || 'WebSocket error'}`),
          )
        },
        { once: true },
      )
    })

    this.socket.addEventListener('message', (event) => {
      void this.handleMessage(event.data)
    })
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout)
        pending.reject(new Error(`CDP socket closed: ${this.url}`))
      }
      this.pending.clear()
    })
    return this
  }

  async handleMessage(raw) {
    if (typeof raw !== 'string') {
      if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw)
      else if (raw?.text) raw = await raw.text()
      else return
    }

    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timeout)
      if (message.error)
        pending.reject(new Error(`CDP ${pending.method}: ${message.error.message}`))
      else pending.resolve(message.result)
      return
    }

    const listeners = this.listeners.get(message.method)
    if (!listeners) return
    for (const listener of listeners) {
      try {
        listener({ params: message.params || {}, sessionId: message.sessionId || null })
      } catch {
        // Profiling observers must never take down the CDP pump.
      }
    }
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set()
    listeners.add(listener)
    this.listeners.set(method, listeners)
    return () => listeners.delete(listener)
  }

  waitForEvent(method, predicate = () => true, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      let timer
      const off = this.on(method, (event) => {
        try {
          if (!predicate(event)) return
          off()
          clearTimeout(timer)
          resolve(event)
        } catch (error) {
          off()
          clearTimeout(timer)
          reject(error)
        }
      })
      timer = setTimeout(() => {
        off()
        reject(new Error(`Timed out waiting for CDP event ${method}`))
      }, timeoutMs)
    })
  }

  send(method, params = {}, sessionId = null, timeoutMs = 20_000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP socket is not open: ${method}`))
    }
    const id = this.nextId++
    const message = { id, method, params }
    if (sessionId) message.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out waiting for CDP ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout, method })
      this.socket.send(JSON.stringify(message))
    })
  }

  async close() {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) return
    this.socket.close()
    await sleep(25)
  }
}

function contextFor(connection, sessionId = null, name = 'target') {
  return {
    connection,
    sessionId,
    name,
    send(method, params = {}, timeoutMs) {
      return connection.send(method, params, sessionId, timeoutMs)
    },
    on(method, listener) {
      return connection.on(method, (event) => {
        if (event.sessionId === sessionId) listener(event)
      })
    },
    waitForEvent(method, predicate = () => true, timeoutMs = 10_000) {
      return connection.waitForEvent(
        method,
        (event) => event.sessionId === sessionId && predicate(event),
        timeoutMs,
      )
    },
  }
}

async function evaluate(context, expression, options = {}) {
  const result = await context.send('Runtime.evaluate', {
    expression,
    awaitPromise: options.awaitPromise !== false,
    returnByValue: options.returnByValue !== false,
    userGesture: options.userGesture !== false,
    includeCommandLineAPI: false,
  })
  if (result?.exceptionDetails) {
    const description =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'Runtime.evaluate failed'
    throw new Error(description)
  }
  return result?.result?.value
}

async function enableContext(
  context,
  { network = false, performance = false, profiler = false, heap = false } = {},
) {
  await context.send('Runtime.enable')
  await context.send('Page.enable').catch(() => undefined)
  if (network) await context.send('Network.enable')
  if (performance) await context.send('Performance.enable')
  if (profiler) await context.send('Profiler.enable').catch(() => undefined)
  if (heap) await context.send('HeapProfiler.enable').catch(() => undefined)
}

async function startCpuProfile(context) {
  if (!context) return false
  try {
    await context.send('Profiler.setSamplingInterval', { interval: 100 })
    await context.send('Profiler.start')
    return true
  } catch {
    return false
  }
}

async function stopCpuProfile(context, filePath) {
  if (!context) return null
  try {
    const result = await context.send('Profiler.stop')
    const summary = summarizeCpuProfile(result?.profile)
    if (filePath && result?.profile) {
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(result.profile), 'utf8')
      return { ...summary, path: filePath }
    }
    return summary
  } catch {
    return null
  }
}

async function captureHeapSnapshot(context, filePath) {
  if (!context || !filePath) return null
  const chunks = []
  const off = context.on('HeapProfiler.addHeapSnapshotChunk', ({ params }) => {
    if (params?.chunk) chunks.push(params.chunk)
  })
  try {
    await context.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, chunks.join(''), 'utf8')
    return { path: filePath, bytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  } finally {
    off()
  }
}

function metricMap(metrics) {
  return Object.fromEntries((metrics || []).map((metric) => [metric.name, metric.value]))
}

function metricDelta(before, after) {
  const names = [
    'TaskDuration',
    'ScriptDuration',
    'LayoutDuration',
    'RecalcStyleDuration',
    'LayoutCount',
    'RecalcStyleCount',
    'JSHeapUsedSize',
    'Nodes',
    'JSEventListeners',
    'Frames',
  ]
  const delta = {}
  for (const name of names) {
    if (typeof before[name] !== 'number' || typeof after[name] !== 'number') continue
    const factor = name.endsWith('Duration') ? 1_000 : 1
    delta[name] = Number(((after[name] - before[name]) * factor).toFixed(3))
  }
  return delta
}

const PROFILE_INSTALL = String.raw`(() => {
  if (window.__arkEditorProfile) return;
  const state = {
    collecting: false,
    label: '',
    startedAt: 0,
    pointerEvents: [],
    previewTimes: [],
    previewMutationTimes: [],
    overlayMutationTimes: [],
    mutationTimes: [],
    rafTimes: [],
    rafIntervals: [],
    mutationCount: 0,
    styleMutationCount: 0,
    childListMutationCount: 0,
    overlayMutationCount: 0,
    geometryReadCount: 0,
    longTasks: [],
    bridgeMessageCount: 0,
    originalRect: null,
    originalPortPostMessage: null,
    observer: null,
    longTaskObserver: null,
  };

  const now = () => performance.now();
  const isOverlay = (node) => node instanceof Element &&
    node.getAttribute('aria-hidden') === 'true' &&
    (node.className || '').toString().includes('border');

  const reset = (label) => {
    state.collecting = true;
    state.label = label || '';
    state.startedAt = now();
    state.pointerEvents = [];
    state.previewTimes = [];
    state.previewMutationTimes = [];
    state.overlayMutationTimes = [];
    state.mutationTimes = [];
    state.firstOverlayMutation = undefined;
    state.rafTimes = [];
    state.rafIntervals = [];
    state.mutationCount = 0;
    state.styleMutationCount = 0;
    state.childListMutationCount = 0;
    state.overlayMutationCount = 0;
    state.geometryReadCount = 0;
    state.longTasks = [];
    state.bridgeMessageCount = 0;
    requestAnimationFrame((timestamp) => {
      if (!state.collecting) return;
      state.rafTimes.push(timestamp);
      requestAnimationFrame(function loop(nextTimestamp) {
        if (!state.collecting) return;
        const previous = state.rafTimes[state.rafTimes.length - 1];
        state.rafTimes.push(nextTimestamp);
        if (typeof previous === 'number') state.rafIntervals.push(nextTimestamp - previous);
        requestAnimationFrame(loop);
      });
    });
  };

  const snapshot = () => {
    const pointerDown = state.pointerEvents.find((event) => event.type === 'pointerdown');
    const firstPreview = state.previewTimes[0] ?? state.previewMutationTimes[0];
    const firstOverlayMutation = state.firstOverlayMutation;
    return {
      label: state.label,
      elapsedMs: Number((now() - state.startedAt).toFixed(3)),
      pointerEvents: state.pointerEvents,
      previewTimes: state.previewTimes,
      timeOrigin: performance.timeOrigin,
      previewMutationTimes: state.previewMutationTimes,
      previewMutationCount: state.previewMutationTimes.length,
      overlayMutationTimes: state.overlayMutationTimes,
      mutationTimes: state.mutationTimes,
      bridgeMessageCount: state.bridgeMessageCount,
      firstPreviewAfterPointerDownMs: pointerDown && typeof firstPreview === 'number'
        ? Number((firstPreview - pointerDown.time).toFixed(3))
        : null,
      firstOverlayAfterPointerDownMs: pointerDown && typeof firstOverlayMutation === 'number'
        ? Number((firstOverlayMutation - pointerDown.time).toFixed(3))
        : null,
      rafCount: state.rafTimes.length,
      rafIntervals: state.rafIntervals,
      maxFrameIntervalMs: state.rafIntervals.length ? Math.max(...state.rafIntervals) : 0,
      frameIntervalsOver33Ms: state.rafIntervals.filter((interval) => interval > 33).length,
      mutationCount: state.mutationCount,
      styleMutationCount: state.styleMutationCount,
      childListMutationCount: state.childListMutationCount,
      overlayMutationCount: state.overlayMutationCount,
      geometryReadCount: state.geometryReadCount,
      longTasks: state.longTasks,
      longTaskCount: state.longTasks.length,
    };
  };

  const stop = () => {
    state.collecting = false;
    return snapshot();
  };

  state.originalRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function profileRect(...args) {
    if (state.collecting) state.geometryReadCount += 1;
    return state.originalRect.apply(this, args);
  };

  const recordPointer = (event) => {
    if (!state.collecting) return;
    state.pointerEvents.push({ type: event.type, pointerId: event.pointerId, time: now() });
  };
  window.addEventListener('pointerdown', recordPointer, true);
  window.addEventListener('pointermove', recordPointer, true);
  window.addEventListener('pointerup', recordPointer, true);
  window.addEventListener('pointercancel', recordPointer, true);

  state.observer = new MutationObserver((records) => {
    if (!state.collecting) return;
    for (const record of records) {
      state.mutationCount += 1;
      state.mutationTimes.push(now());
      if (record.type === 'attributes' && record.attributeName === 'style') {
        state.styleMutationCount += 1;
        if (record.target instanceof Element && record.target.hasAttribute('data-ark-editor-live-transform')) {
          state.previewMutationTimes.push(now());
        }
        if (isOverlay(record.target)) {
          state.overlayMutationCount += 1;
          const overlayTime = now();
          state.overlayMutationTimes.push(overlayTime);
          state.firstOverlayMutation ??= overlayTime;
        }
      }
      if (record.type === 'attributes' && record.attributeName === 'data-ark-editor-live-transform') {
        state.previewMutationTimes.push(now());
      }
      if (record.type === 'childList') state.childListMutationCount += 1;
    }
  });
  state.observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'data-ark-editor-live-transform'],
  });

  if (typeof PerformanceObserver === 'function') {
    try {
      state.longTaskObserver = new PerformanceObserver((list) => {
        if (!state.collecting) return;
        for (const entry of list.getEntries()) {
          state.longTasks.push({
            startTime: Number(entry.startTime.toFixed(3)),
            duration: Number(entry.duration.toFixed(3)),
          });
        }
      });
      state.longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {}
  }

  const recordBridgeMessage = (message) => {
    if (state.collecting && message && message.type === 'ark:editor-transform-preview') {
      state.bridgeMessageCount += 1;
      state.previewTimes.push(now());
    }
  };

  const observePortMessage = (port) => {
    if (!port || port.__arkProfileWrapped) return;
    const original = port.postMessage;
    if (typeof original !== 'function') return;
    const wrapped = function profilePortMessage(message, ...args) {
      recordBridgeMessage(message);
      return original.call(this, message, ...args);
    };
    try {
      Object.defineProperty(port, '__arkProfileWrapped', { value: true });
      port.postMessage = wrapped;
    } catch {}
  };

  if (typeof MessagePort === 'function') {
    state.originalPortPostMessage = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function profilePortMessage(message, ...args) {
      recordBridgeMessage(message);
      return state.originalPortPostMessage.call(this, message, ...args);
    };
  }

  if (typeof MessageChannel === 'function') {
    const OriginalMessageChannel = MessageChannel;
    const ProfileMessageChannel = function ProfileMessageChannel(...args) {
      const channel = new OriginalMessageChannel(...args);
      observePortMessage(channel.port1);
      observePortMessage(channel.port2);
      return channel;
    };
    ProfileMessageChannel.prototype = OriginalMessageChannel.prototype;
    try { window.MessageChannel = ProfileMessageChannel; } catch {}
  }

  window.__arkEditorProfile = {
    reset,
    stop,
    snapshot,
    getState: () => ({ collecting: state.collecting, label: state.label }),
  };
})()`

const FRAME_ELEMENT_QUERY = '[data-ark-id]:not([data-ark-spacer])'

function absoluteDeck(count) {
  const elements = Array.from({ length: count }, (_, index) => {
    const left = 24 + (index % 20) * 52
    const top = 24 + Math.floor(index / 20) * 44
    return `<div data-ark-id="ark-el-${index}" data-ark-managed="true" data-ark-editable="true" style="position:absolute;left:${left}px;top:${top}px;width:80px;height:32px;box-sizing:border-box;padding:4px;background:#dbeafe;color:#172033;border:1px solid #60a5fa">Item ${index}</div>`
  }).join('\n')
  return `<!doctype html><html lang="en" data-deck="profile-absolute"><head><meta charset="utf-8"><title>Profile absolute ${count}</title><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;font-family:system-ui,sans-serif}section.slide{display:none;position:relative;width:100vw;height:100vh;background:#fff;color:#172033}section.slide.active{display:block}</style></head><body><section class="slide active" data-ark-slide-id="profile-slide">${elements}</section></body></html>`
}

function adoptionDeck() {
  return `<!doctype html><html lang="en" data-deck="profile-adoption"><head><meta charset="utf-8"><title>Profile adoption</title><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;font-family:system-ui,sans-serif}section.slide{display:none;position:relative;width:100vw;height:100vh;background:#fff;color:#172033;padding:64px;box-sizing:border-box}section.slide.active{display:block}.flow{width:720px;margin:24px auto;padding:24px;background:#eff6ff;border:1px solid #93c5fd}</style></head><body><section class="slide active" data-ark-slide-id="profile-slide"><div class="flow"><h1 data-ark-id="ark-el-adoption" data-ark-managed="true" data-ark-editable="true">Flow title to adopt</h1><p>Moving this title adopts it into the slide coordinate system.</p></div></section></body></html>`
}

async function revealDeck() {
  const fixture = await readFile(revealFixturePath, 'utf8')
  const elements = Array.from({ length: 50 }, (_, index) => {
    const left = 32 + (index % 10) * 70
    const top = 32 + Math.floor(index / 10) * 48
    return `<div data-ark-id="ark-el-${index}" data-ark-managed="true" data-ark-editable="true" style="position:absolute;left:${left}px;top:${top}px;width:60px;height:30px;box-sizing:border-box;padding:3px;background:#dbeafe;color:#172033">R${index}</div>`
  }).join('\n')
  return fixture.replace('</section>', `${elements}</section>`)
}

async function buildCases() {
  return {
    'absolute-100': { html: absoluteDeck(100), elementId: 'ark-el-0', kind: 'absolute' },
    'absolute-500': { html: absoluteDeck(500), elementId: 'ark-el-0', kind: 'absolute' },
    'reveal-50': { html: await revealDeck(), elementId: 'ark-el-0', kind: 'reveal' },
    adoption: { html: adoptionDeck(), elementId: 'ark-el-adoption', kind: 'adoption' },
  }
}

async function launchElectron(options) {
  const ephemeralUserData = !options.userDataDir
  const profileDirectory = options.userDataDir
    ? path.resolve(options.userDataDir)
    : await mkdtemp(path.join(os.tmpdir(), 'ark-editor-profile-'))
  await mkdir(profileDirectory, { recursive: true })
  const workspacesDirectory = path.resolve(
    options.workspacesDir || path.join(profileDirectory, 'workspaces'),
  )
  await mkdir(workspacesDirectory, { recursive: true })
  const storage = {
    userData: await inspectStoragePath(profileDirectory),
    workspaces: await inspectStoragePath(workspacesDirectory),
  }
  if (storage.userData.ephemeral || storage.workspaces.ephemeral) {
    console.error(
      `Storage is ephemeral (${storage.workspaces.fsType} at ${storage.workspaces.path}). PATCH persist timings will not match a real disk. See docs/editor-drag-profiling.md.`,
    )
  }

  const port = randomPort()
  const inspectPort = options.cpuProfile || options.heapSnapshot ? randomInspectPort() : 0
  const electronArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    '--window-size=1440,960',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
  ]
  if (inspectPort) electronArgs.push(`--inspect=${inspectPort}`)
  electronArgs.push('.')
  let command = electronBinary
  let args = electronArgs
  if (process.platform === 'linux' && !process.env.DISPLAY && !options.headed) {
    if (existsSync('/usr/bin/xvfb-run')) {
      command = '/usr/bin/xvfb-run'
      args = ['-a', '--server-args=-screen 0 1440x960x24', electronBinary, ...electronArgs]
    } else {
      // CI/dev containers often omit Xvfb. Electron 43's new headless mode still
      // exposes BrowserWindow pages and CDP input, so use it as a display-free
      // fallback rather than failing before the benchmark starts.
      args = ['--headless=new', '--disable-gpu', ...electronArgs]
    }
  }

  const child = spawn(command, args, {
    cwd: desktop,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      ARK_WORKSPACES_DIR: workspacesDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const logs = []
  let pendingOutput = ''
  const consume = (chunk, stream) => {
    pendingOutput += chunk.toString()
    const lines = pendingOutput.split(/\r?\n/)
    pendingOutput = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed = null
      try {
        parsed = JSON.parse(trimmed)
      } catch {}
      logs.push({
        stream,
        text: trimmed,
        ...(parsed && typeof parsed === 'object' ? { structured: parsed } : {}),
      })
      if (process.env.ARK_PROFILE_VERBOSE === '1') console.error(`[${stream}] ${trimmed}`)
    }
  }
  child.stdout.on('data', (chunk) => consume(chunk, 'stdout'))
  child.stderr.on('data', (chunk) => consume(chunk, 'stderr'))

  const debuggerBase = `http://127.0.0.1:${port}`
  await waitFor(
    'Electron remote debugger',
    async () => {
      try {
        await fetchJson(`${debuggerBase}/json/version`)
        return true
      } catch {
        if (child.exitCode !== null) throw new Error(`Electron exited with code ${child.exitCode}`)
        return false
      }
    },
    30_000,
  )

  const targets = await waitFor(
    'Ark page target',
    async () => {
      const listed = await fetchJson(`${debuggerBase}/json/list`)
      return listed.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    },
    30_000,
  )
  const connection = await new CdpConnection(targets.webSocketDebuggerUrl).connect()
  const page = contextFor(connection, null, 'shell')
  await enableContext(page, {
    network: true,
    performance: true,
    profiler: true,
    heap: options.heapSnapshot,
  })
  await page
    .send('Page.addScriptToEvaluateOnNewDocument', { source: PROFILE_INSTALL })
    .catch(() => undefined)

  let main = null
  if (inspectPort) {
    const inspectBase = `http://127.0.0.1:${inspectPort}`
    const inspectTarget = await waitFor(
      'Electron main inspector',
      async () => {
        try {
          const listed = await fetchJson(`${inspectBase}/json`)
          const items = Array.isArray(listed) ? listed : listed ? [listed] : []
          return items.find((target) => target.webSocketDebuggerUrl) || null
        } catch {
          if (child.exitCode !== null)
            throw new Error(`Electron exited with code ${child.exitCode}`)
          return null
        }
      },
      15_000,
    )
    if (inspectTarget?.webSocketDebuggerUrl) {
      const mainConnection = await new CdpConnection(inspectTarget.webSocketDebuggerUrl).connect()
      main = contextFor(mainConnection, null, 'electron-main')
      await main.send('Profiler.enable').catch(() => undefined)
      if (options.heapSnapshot) await main.send('HeapProfiler.enable').catch(() => undefined)
    } else {
      console.error(
        'Electron main inspector did not expose a websocket; main CPU profiles skipped.',
      )
    }
  }

  await waitFor(
    'shell HTTP origin and API',
    async () => {
      const href = await evaluate(page, 'location.href').catch(() => '')
      if (!href || !String(href).startsWith('http')) return false
      try {
        return Boolean(
          await evaluate(
            page,
            `fetch('/api/health').then((response) => response.ok).catch(() => false)`,
          ),
        )
      } catch {
        return false
      }
    },
    90_000,
  )

  return {
    child,
    logs,
    profileDirectory,
    workspacesDirectory,
    storage,
    ephemeralUserData,
    port,
    inspectPort,
    debuggerBase,
    connection,
    page,
    main,
    cpuProfile: options.cpuProfile,
    heapSnapshot: options.heapSnapshot,
    artifactsDir: options.artifactsDir,
    async close() {
      try {
        await connection.close()
      } catch {}
      try {
        await main?.connection.close()
      } catch {}
      const killTree = (signal) => {
        if (child.exitCode !== null) return
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
          else child.kill(signal)
        } catch {
          child.kill(signal)
        }
      }
      killTree('SIGTERM')
      await waitFor('Electron shutdown', () => child.exitCode !== null, 10_000, 50).catch(() =>
        killTree('SIGKILL'),
      )
      if (!options.keepProfile && ephemeralUserData)
        await rm(profileDirectory, { recursive: true, force: true })
    },
  }
}

async function listTargets(debuggerBase) {
  return fetchJson(`${debuggerBase}/json/list`)
}

async function getIframeContext(session) {
  const expectedUrl = await evaluate(
    session.page,
    `document.querySelector('iframe[title=\"Generated Ark presentation preview\"]')?.src || ''`,
  )
  const expectedPath = expectedUrl ? new URL(expectedUrl).pathname : ''
  const target = await waitFor(
    'sandbox iframe target',
    async () => {
      const targets = await session.connection.send('Target.getTargets')
      return targets.targetInfos.find((info) => {
        if (info.type !== 'iframe' || !info.url.includes('/render/')) return false
        if (!expectedPath) return true
        try {
          return new URL(info.url).pathname === expectedPath
        } catch {
          return false
        }
      })
    },
    20_000,
  )

  if (session.iframe && session.iframe.targetId === target.targetId) return session.iframe
  if (session.iframe) {
    await session.connection
      .send('Target.detachFromTarget', { sessionId: session.iframe.sessionId })
      .catch(() => undefined)
  }
  const attached = await session.connection.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  })
  const iframe = contextFor(session.connection, attached.sessionId, 'sandbox-iframe')
  iframe.targetId = target.targetId
  iframe.targetUrl = target.url
  await enableContext(iframe, {
    performance: true,
    profiler: true,
    heap: Boolean(session.heapSnapshot),
  })
  await evaluate(iframe, PROFILE_INSTALL)
  session.iframe = iframe
  return iframe
}

async function shellFetch(page, url, init = {}) {
  const expression = `fetch(${JSON.stringify(url)}, ${JSON.stringify(init)}).then(async (response) => ({ status: response.status, body: await response.text() }))`
  const response = await evaluate(page, expression)
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error(`Shell fetch failed (${response?.status}): ${response?.body || url}`)
  }
  try {
    return JSON.parse(response.body)
  } catch {
    return response.body
  }
}

async function createDeck(page, html) {
  return shellFetch(page, '/api/decks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html, origin: 'blank' }),
  })
}

async function deleteDeck(page, deckId) {
  await evaluate(
    page,
    `fetch('/api/decks/${encodeURIComponent(deckId)}', { method: 'DELETE' }).catch(() => undefined)`,
  ).catch(() => undefined)
}

async function navigateToDeck(session, deckId) {
  const origin = await evaluate(session.page, 'location.origin')
  await session.page.send('Page.navigate', { url: `${origin}/decks/${encodeURIComponent(deckId)}` })
  await waitFor('deck editor route', async () =>
    evaluate(session.page, `location.pathname === '/decks/${encodeURIComponent(deckId)}'`),
  )
  await waitFor(
    'preview iframe element',
    async () =>
      evaluate(
        session.page,
        `Boolean(document.querySelector('iframe[title="Generated Ark presentation preview"]'))`,
      ),
    30_000,
  )
  let iframe = await getIframeContext(session)
  // Install a future-document hook when the target allows it. The current
  // document is instrumented below; live-transform mutations remain a reliable
  // proxy even when Chromium refuses Page.addScriptToNewDocument for an OOPIF.
  await iframe
    .send('Page.addScriptToEvaluateOnNewDocument', { source: PROFILE_INSTALL })
    .catch((error) => {
      if (process.env.ARK_PROFILE_VERBOSE === '1')
        console.error(`iframe addScriptToEvaluateOnNewDocument failed: ${error.message}`)
    })
  await waitFor(
    'editor element in sandbox',
    async () =>
      evaluate(
        iframe,
        `document.querySelectorAll(${JSON.stringify(FRAME_ELEMENT_QUERY)}).length > 0`,
      ),
    30_000,
  )
  await evaluate(session.page, PROFILE_INSTALL)
  await evaluate(iframe, PROFILE_INSTALL)
  return iframe
}

async function waitForPreviewReady(session, iframe) {
  let lastLogAt = 0
  await waitFor(
    'editor bridge and preview geometry',
    async () => {
      const shellState = await evaluate(
        session.page,
        `(() => { const node = document.querySelector('iframe[title=\"Generated Ark presentation preview\"]'); const rect = node?.getBoundingClientRect(); return { ready: Boolean(node), src: node?.src || '', key: node?.getAttribute('data-ark-preview-key') || '', width: rect?.width || 0, height: rect?.height || 0, viewport: [document.documentElement.clientWidth, document.documentElement.clientHeight], body: [document.body?.clientWidth || 0, document.body?.clientHeight || 0] }; })()`,
      )
      const frameState = await evaluate(
        iframe,
        `(() => { const slide = document.querySelector('section.slide, .reveal .slides > section.present, .reveal .slides > section'); const element = document.querySelector(${JSON.stringify(FRAME_ELEMENT_QUERY)}); const slideRect = slide?.getBoundingClientRect(); const elementRect = element?.getBoundingClientRect(); return { slide: Boolean(slide), element: Boolean(element), slideWidth: slideRect?.width || 0, slideHeight: slideRect?.height || 0, elementWidth: elementRect?.width || 0, elementHeight: elementRect?.height || 0, href: location.href }; })()`,
      )
      if (process.env.ARK_PROFILE_VERBOSE === '1' && Date.now() - lastLogAt > 1_000) {
        lastLogAt = Date.now()
        console.error(
          `preview readiness: ${JSON.stringify({ shellState, frameState, targetId: iframe.targetId })}`,
        )
      }
      return (
        shellState.ready &&
        frameState.slide &&
        frameState.element &&
        frameState.elementWidth > 0 &&
        frameState.elementHeight > 0
      )
    },
    30_000,
  )
  await sleep(350)
}

async function resetProfile(context, label) {
  await evaluate(context, `window.__arkEditorProfile?.reset(${JSON.stringify(label)})`)
}

async function snapshotProfile(context) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  return evaluate(context, 'window.__arkEditorProfile?.stop() || null')
}

async function readPerformance(context) {
  const result = await context.send('Performance.getMetrics')
  return metricMap(result.metrics)
}

function networkCollector(session) {
  const requests = []
  const responses = []
  const finished = []
  const offRequest = session.page.on('Network.requestWillBeSent', ({ params }) => {
    requests.push({
      requestId: params.requestId,
      url: params.request?.url,
      method: params.request?.method,
      timestamp: params.timestamp,
      wallTime: params.wallTime,
      type: params.type,
    })
  })
  const offResponse = session.page.on('Network.responseReceived', ({ params }) => {
    responses.push({
      requestId: params.requestId,
      url: params.response?.url,
      status: params.response?.status,
      timestamp: params.timestamp,
      mimeType: params.response?.mimeType,
      encodedDataLength: params.response?.encodedDataLength,
      timing: params.response?.timing || null,
    })
  })
  const offFinished = session.page.on('Network.loadingFinished', ({ params }) => {
    finished.push({
      requestId: params.requestId,
      timestamp: params.timestamp,
      encodedDataLength: params.encodedDataLength,
    })
  })
  return {
    requests,
    responses,
    finished,
    reset() {
      requests.length = 0
      responses.length = 0
      finished.length = 0
    },
    stop() {
      offRequest()
      offResponse()
      offFinished()
    },
  }
}

function requestKind(url) {
  if (!url) return 'other'
  if (/\/patch(?:\?|$)/.test(url)) return 'patch'
  if (/\/api\/decks\/[^/]+$/.test(url)) return 'deck-read'
  if (/\/thumbnails(?:\?|$)/.test(url)) return 'thumbnail-status'
  if (/\/preview-sessions/.test(url)) return 'preview-session'
  if (/\/render\//.test(url)) return 'sandbox-render'
  return 'other'
}

function summarizeNetwork(network) {
  const requests = network.requests.map((request) => ({
    ...request,
    kind: requestKind(request.url),
  }))
  const responses = network.responses.map((response) => ({
    ...response,
    kind: requestKind(response.url),
  }))
  const finishedById = new Map((network.finished || []).map((entry) => [entry.requestId, entry]))
  const patchRequests = requests.filter((request) => request.kind === 'patch')
  const patchResponses = responses.filter((response) => response.kind === 'patch')
  const patch = patchRequests.map((request) => {
    const response = patchResponses.find((entry) => entry.requestId === request.requestId)
    const loaded = finishedById.get(request.requestId)
    const timing = response?.timing || null
    const waitingMs =
      timing && typeof timing.receiveHeadersEnd === 'number' && typeof timing.sendEnd === 'number'
        ? roundMs(timing.receiveHeadersEnd - timing.sendEnd)
        : null
    const receiveMs =
      timing && loaded && typeof timing.requestTime === 'number'
        ? roundMs((loaded.timestamp - timing.requestTime) * 1_000 - timing.receiveHeadersEnd)
        : null
    return {
      requestId: request.requestId,
      url: request.url,
      method: request.method,
      status: response?.status ?? null,
      ttfbMs:
        request && response ? roundMs((response.timestamp - request.timestamp) * 1_000) : null,
      loadingFinishedMs:
        request && loaded ? roundMs((loaded.timestamp - request.timestamp) * 1_000) : null,
      encodedDataLength: loaded?.encodedDataLength ?? response?.encodedDataLength ?? null,
      waitingMs,
      receiveMs,
      timing,
    }
  })
  return {
    requestCount: requests.length,
    patchRequests,
    patchResponses,
    patch,
    thumbnailRequests: requests.filter((request) => request.kind === 'thumbnail-status'),
    requests,
    responses,
    finished: network.finished || [],
  }
}

function structuredLogsBetween(logs, startIndex) {
  return logs
    .slice(startIndex)
    .filter((entry) => entry.structured && typeof entry.structured === 'object')
    .map((entry) => entry.structured)
}

async function inspectElement(iframe, elementId) {
  const expression = `(() => { const element = document.querySelector('[data-ark-id="${elementId}"]'); if (!element) return null; const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2, id: element.getAttribute('data-ark-id'), html: element.outerHTML.slice(0, 500) }; })()`
  return evaluate(iframe, expression)
}

async function dispatchMouse(context, type, point, buttons = 0) {
  await context.send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    buttons,
    clickCount: type === 'mousePressed' ? 1 : 0,
  })
}

async function drag(
  _shell,
  frame,
  elementId,
  { cancel = false, offsetX = 34, offsetY = 22, steps = DEFAULT_DRAG_STEPS } = {},
) {
  const before = await inspectElement(frame, elementId)
  if (!before) throw new Error(`Could not find ${elementId} in sandbox.`)
  // Input.dispatchMouseEvent on the attached OOPIF target is the only form that
  // consistently routes pointer capture into a sandboxed Electron iframe. The
  // coordinates are frame-local CSS pixels, matching getBoundingClientRect().
  const start = { x: before.centerX, y: before.centerY }
  const finish = { x: start.x + offsetX, y: start.y + offsetY }
  await dispatchMouse(frame, 'mouseMoved', start)
  await dispatchMouse(frame, 'mousePressed', start, 1)
  const moveCount = steps
  for (let index = 1; index <= moveCount; index += 1) {
    const point = {
      x: start.x + ((finish.x - start.x) * index) / moveCount,
      y: start.y + ((finish.y - start.y) * index) / moveCount,
    }
    await dispatchMouse(frame, 'mouseMoved', point, 1)
    await sleep(8)
  }
  if (cancel) {
    // CDP's mouse domain has no pointercancel command. Dispatching a native
    // PointerEvent through the target DOM exercises the same private runtime
    // listener without forging Ark's public postMessage protocol.
    await evaluate(
      frame,
      `document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerId: 1, clientX: ${finish.x}, clientY: ${finish.y} }))`,
    )
    // Clear Chromium's physical button state after the synthetic cancel. Without
    // this, the next CDP gesture can be interpreted as a move on the canceled
    // pointer rather than a fresh press.
    await dispatchMouse(frame, 'mouseReleased', finish, 0)
  } else {
    await dispatchMouse(frame, 'mouseReleased', finish, 0)
  }
  return { before, start, finish }
}

async function waitForDeck(page, deckId, predicate, timeoutMs = 15_000) {
  return waitFor(
    'deck API state',
    async () => {
      const payload = await shellFetch(page, `/api/decks/${encodeURIComponent(deckId)}`)
      return predicate(payload.deck) ? payload.deck : false
    },
    timeoutMs,
    100,
  )
}

async function traceStart(context, collector) {
  if (!collector) return
  collector.events = []
  collector.off?.()
  collector.off = context.on('Tracing.dataCollected', ({ params }) => {
    for (const event of params.value || []) collector.events.push(event)
  })
  collector.complete = new Promise((resolve) => {
    const offComplete = context.connection.on('Tracing.tracingComplete', (event) => {
      // Chromium sometimes omits sessionId for tracingComplete on an OOPIF;
      // accept an unscoped event when this is the only active collector.
      if (context.sessionId && event.sessionId && event.sessionId !== context.sessionId) return
      offComplete()
      resolve()
    })
    collector.completeOff = offComplete
    collector.completeTimeout = setTimeout(() => {
      offComplete()
      resolve()
    }, 5_000)
  })
  await context
    .send('Tracing.start', {
      categories: TRACE_CATEGORIES,
      options: 'record-until-full',
    })
    .catch(() => {
      collector.disabled = true
    })
}

async function traceStop(context, collector) {
  if (!collector || collector.disabled) return []
  await context.send('Tracing.end').catch(() => undefined)
  await collector.complete.catch(() => undefined)
  clearTimeout(collector.completeTimeout)
  collector.completeOff?.()
  collector.off?.()
  return collector.events || []
}

function summarizeTrace(events) {
  const selected = ['UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint', 'FunctionCall', 'RunTask']
  const summary = {}
  for (const name of selected) {
    const values = events
      .filter((event) => event.name === name && typeof event.dur === 'number')
      .map((event) => event.dur / 1_000)
    if (!values.length) continue
    summary[name] = {
      count: values.length,
      totalMs: Number(values.reduce((sum, value) => sum + value, 0).toFixed(3)),
      maxMs: Number(Math.max(...values).toFixed(3)),
    }
  }
  return summary
}

function phaseTimings(frameProfile, shellProfile, patchRequest, patchResponse, patchFinished) {
  const pointerUp = [...(frameProfile?.pointerEvents || [])]
    .reverse()
    .find((event) => event.type === 'pointerup' || event.type === 'pointercancel')
  const pointerUpWallMs =
    pointerUp && frameProfile.timeOrigin ? frameProfile.timeOrigin + pointerUp.time : null
  const requestWallMs = patchRequest?.wallTime ? patchRequest.wallTime * 1_000 : null
  const responseWallMs =
    requestWallMs !== null && patchRequest && patchResponse
      ? requestWallMs + (patchResponse.timestamp - patchRequest.timestamp) * 1_000
      : null
  const firstAtOrAfter = (times, origin, wallMs) => {
    if (!origin || wallMs === null || !times?.length) return null
    const timestamp = times.find((time) => origin + time >= wallMs)
    return timestamp === undefined ? null : origin + timestamp
  }
  const firstOverlayWallMs = firstAtOrAfter(
    shellProfile?.overlayMutationTimes,
    shellProfile?.timeOrigin,
    responseWallMs,
  )
  const firstFrameMutationWallMs = firstAtOrAfter(
    frameProfile?.mutationTimes,
    frameProfile?.timeOrigin,
    responseWallMs,
  )
  const duration = (from, to) =>
    from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to)
      ? null
      : Number((to - from).toFixed(3))

  const timing = patchResponse?.timing || null
  return {
    pointerDownToFirstPreviewMs: frameProfile?.firstPreviewAfterPointerDownMs ?? null,
    pointerUpToPatchRequestMs: duration(pointerUpWallMs, requestWallMs),
    patchRequestToResponseMs:
      patchRequest && patchResponse
        ? Number(((patchResponse.timestamp - patchRequest.timestamp) * 1_000).toFixed(3))
        : null,
    patchRequestToLoadingFinishedMs:
      patchRequest && patchFinished
        ? Number(((patchFinished.timestamp - patchRequest.timestamp) * 1_000).toFixed(3))
        : null,
    patchWaitingMs:
      timing && typeof timing.receiveHeadersEnd === 'number' && typeof timing.sendEnd === 'number'
        ? roundMs(timing.receiveHeadersEnd - timing.sendEnd)
        : null,
    patchReceiveMs:
      timing &&
      patchFinished &&
      typeof timing.requestTime === 'number' &&
      typeof timing.receiveHeadersEnd === 'number'
        ? roundMs((patchFinished.timestamp - timing.requestTime) * 1_000 - timing.receiveHeadersEnd)
        : null,
    patchEncodedDataLength:
      patchFinished?.encodedDataLength ?? patchResponse?.encodedDataLength ?? null,
    responseToFrameMutationMs: duration(responseWallMs, firstFrameMutationWallMs),
    responseToOverlayMutationMs: duration(responseWallMs, firstOverlayWallMs),
  }
}

function patchPhasesFromLogs(logs) {
  const entry = logs.find((item) => item.event === 'deck.patch.completed')
  if (!entry) return null
  const fields = entry.fields || {}
  return {
    durationMs: entry.durationMs ?? fields.durationMs ?? null,
    loadMs: fields.loadMs ?? null,
    applyMs: fields.applyMs ?? null,
    validateMs: fields.validateMs ?? null,
    persistMs: fields.persistMs ?? null,
    notifyMs: fields.notifyMs ?? null,
    serializeMs: fields.serializeMs ?? null,
    htmlBytes: fields.htmlBytes ?? null,
    reusedValidation: fields.reusedValidation ?? null,
    documentRevision: fields.documentRevision ?? null,
    appliedCount: fields.appliedCount ?? null,
  }
}

async function performGesture(
  session,
  iframe,
  network,
  deck,
  elementId,
  { cancel, trace, steps, label },
) {
  const beforeRevision = deck.documentRevision
  const startLogIndex = session.logs.length
  network.reset()
  const shellBefore = await readPerformance(session.page)
  const frameBefore = await readPerformance(iframe)
  await resetProfile(session.page, cancel ? 'cancel-shell' : 'commit-shell')
  await resetProfile(iframe, cancel ? 'cancel-frame' : 'commit-frame')

  const shellTrace = trace ? {} : null
  const frameTrace = trace ? {} : null
  await traceStart(session.page, shellTrace)
  await traceStart(iframe, frameTrace)
  if (session.cpuProfile) {
    await startCpuProfile(session.page)
    await startCpuProfile(iframe)
    await startCpuProfile(session.main)
  }
  const gesture = await drag(session.page, iframe, elementId, { cancel, steps })
  await sleep(cancel ? 120 : 160)
  const shellAfter = await readPerformance(session.page)
  const frameAfter = await readPerformance(iframe)
  const frameProfile = await snapshotProfile(iframe)
  const shellProfile = await snapshotProfile(session.page)
  const frameTraceEvents = await traceStop(iframe, frameTrace)
  const shellTraceEvents = await traceStop(session.page, shellTrace)

  let afterDeck = deck
  if (!cancel) {
    afterDeck = await waitForDeck(
      session.page,
      deck.id,
      (candidate) => candidate.documentRevision > beforeRevision,
      20_000,
    )
  } else {
    await sleep(250)
    afterDeck = await shellFetch(session.page, `/api/decks/${encodeURIComponent(deck.id)}`)
    afterDeck = afterDeck.deck
  }

  const cpuProfiles = session.cpuProfile
    ? {
        shell: await stopCpuProfile(
          session.page,
          session.artifactsDir
            ? path.join(session.artifactsDir, `${label || 'gesture'}-shell.cpuprofile`)
            : null,
        ),
        iframe: await stopCpuProfile(
          iframe,
          session.artifactsDir
            ? path.join(session.artifactsDir, `${label || 'gesture'}-iframe.cpuprofile`)
            : null,
        ),
        main: await stopCpuProfile(
          session.main,
          session.artifactsDir
            ? path.join(session.artifactsDir, `${label || 'gesture'}-main.cpuprofile`)
            : null,
        ),
      }
    : null

  let heapSnapshots = null
  if (session.heapSnapshot && !cancel && session.artifactsDir) {
    const stem = label || 'commit'
    heapSnapshots = {
      shell: await captureHeapSnapshot(
        session.page,
        path.join(session.artifactsDir, `${stem}-shell.heapsnapshot`),
      ),
      iframe: await captureHeapSnapshot(
        iframe,
        path.join(session.artifactsDir, `${stem}-iframe.heapsnapshot`),
      ),
    }
  }

  const networkSummary = summarizeNetwork(network)
  const patchRequests = networkSummary.patchRequests
  const patchResponses = networkSummary.patchResponses
  const patchFinished = (network.finished || []).find(
    (entry) => entry.requestId === patchRequests[0]?.requestId,
  )
  const frameTargetId = session.iframe?.targetId || null
  const logs = structuredLogsBetween(session.logs, startLogIndex)
  return {
    action: cancel ? 'cancel' : 'commit',
    beforeRevision,
    afterRevision: afterDeck.documentRevision,
    requestCount: patchRequests.length,
    patchResponseCount: patchResponses.length,
    patchRequests,
    patchResponses,
    phaseTimings: phaseTimings(
      frameProfile,
      shellProfile,
      patchRequests[0] || null,
      patchResponses[0] || null,
      patchFinished || null,
    ),
    serverPatch: patchPhasesFromLogs(logs),
    network: networkSummary,
    serverEvents: logs.filter((entry) =>
      /patch|validation|thumbnail|http\.request/.test(entry.event || ''),
    ),
    shellMetrics: metricDelta(shellBefore, shellAfter),
    iframeMetrics: metricDelta(frameBefore, frameAfter),
    shellProfile,
    iframeProfile: frameProfile,
    cpuProfiles,
    heapSnapshots,
    trace: {
      shell: summarizeTrace(shellTraceEvents),
      iframe: summarizeTrace(frameTraceEvents),
    },
    gesture,
    iframeTargetId: frameTargetId,
  }
}

async function triggerUndo(page) {
  // The preview OOPIF owns focus after a drag. Clicking the enabled toolbar
  // control routes through the same production undo callback without relying
  // on Chromium focus routing for a synthetic keyboard event.
  await evaluate(page, `document.querySelector('button[aria-label="Undo"]')?.click()`)
}

async function performUndoCheck(session, deckId, baselineHtml, baselineRevision, network) {
  const beforeLogIndex = session.logs.length
  network.reset()
  await triggerUndo(session.page)
  const undone = await waitForDeck(
    session.page,
    deckId,
    (deck) => deck.documentRevision > baselineRevision,
    20_000,
  )
  const requests = summarizeNetwork(network)
  return {
    documentRevision: undone.documentRevision,
    htmlRestored: undone.html === baselineHtml,
    putRequests: requests.requests.filter(
      (request) =>
        (request.method === 'PUT' && request.kind === 'deck-read') || request.method === 'PUT',
    ),
    network: requests,
    serverEvents: structuredLogsBetween(session.logs, beforeLogIndex).filter((entry) =>
      /deck|http\.request/.test(entry.event || ''),
    ),
  }
}

function assertInvariant(name, condition, details) {
  return { name, ok: Boolean(condition), details }
}

async function runCase(session, testCase, options) {
  const created = await createDeck(session.page, testCase.html)
  const deck = created.deck
  if (!deck?.id) throw new Error(`${testCase.name}: create response did not include a deck id.`)
  let iframe = await navigateToDeck(session, deck.id)
  await waitForPreviewReady(session, iframe)
  const network = networkCollector(session)
  const originalTargetId = iframe.targetId
  const baseline = await shellFetch(session.page, `/api/decks/${encodeURIComponent(deck.id)}`)
  const baselineHtml = baseline.deck.html
  const runs = []

  for (let run = 0; run < options.runs; run += 1) {
    iframe = await getIframeContext(session)
    await waitForPreviewReady(session, iframe)
    const cancel = await performGesture(session, iframe, network, deck, testCase.elementId, {
      cancel: true,
      trace: options.trace,
      steps: options.steps,
      label: `${testCase.name}-run${run + 1}-cancel`,
    })
    runs.push({ run: run + 1, phase: 'cancel', ...cancel })
    const commit = await performGesture(session, iframe, network, deck, testCase.elementId, {
      cancel: false,
      trace: options.trace,
      steps: options.steps,
      label: `${testCase.name}-run${run + 1}-commit`,
    })
    runs.push({ run: run + 1, phase: 'commit', ...commit })
    if (run === 0 && options.undo) {
      const undo = await performUndoCheck(
        session,
        deck.id,
        baselineHtml,
        commit.afterRevision,
        network,
      )
      runs.push({ run: run + 1, phase: 'undo', ...undo })
      if (undo.documentRevision > deck.documentRevision) {
        deck.documentRevision = undo.documentRevision
      }
    }
    const currentTarget = (await getIframeContext(session)).targetId
    const retainedRun =
      runs.find((entry) => entry.run === run + 1 && entry.phase === 'commit') ||
      runs[runs.length - 1]
    const sessionRetained = currentTarget === originalTargetId
    retainedRun.sessionRetained = sessionRetained
    const undoRun = runs.find((entry) => entry.run === run + 1 && entry.phase === 'undo')
    if (undoRun) undoRun.sessionRetained = sessionRetained
    if (commit.afterRevision > deck.documentRevision) deck.documentRevision = commit.afterRevision
  }

  network.stop()
  await deleteDeck(session.page, deck.id)
  const invariants = runs
    .filter((run) => run.phase === 'cancel' || run.phase === 'commit')
    .map((run) => {
      if (run.phase === 'cancel') {
        return assertInvariant(
          `${testCase.name} run ${run.run} cancellation`,
          run.requestCount === 0 && run.afterRevision === run.beforeRevision,
          {
            patchRequests: run.requestCount,
            beforeRevision: run.beforeRevision,
            afterRevision: run.afterRevision,
          },
        )
      }
      return assertInvariant(
        `${testCase.name} run ${run.run} commit`,
        run.requestCount === 1 &&
          run.afterRevision > run.beforeRevision &&
          run.sessionRetained !== false,
        {
          patchRequests: run.requestCount,
          beforeRevision: run.beforeRevision,
          afterRevision: run.afterRevision,
          sessionRetained: run.sessionRetained,
        },
      )
    })

  if (options.undo) {
    const undo = runs.find((run) => run.phase === 'undo')
    invariants.push(
      assertInvariant(
        `${testCase.name} run 1 undo`,
        Boolean(
          undo &&
          undo.documentRevision > 1 &&
          undo.htmlRestored === true &&
          undo.putRequests?.length === 1 &&
          undo.sessionRetained !== false,
        ),
        {
          documentRevision: undo?.documentRevision,
          htmlRestored: undo?.htmlRestored,
          putRequests: undo?.putRequests?.length ?? 0,
          sessionRetained: undo?.sessionRetained,
        },
      ),
    )
  }

  return {
    name: testCase.name,
    elementId: testCase.elementId,
    runs,
    invariants,
  }
}

function flattenInvariantFailures(report) {
  return report.results.flatMap((result) => result.invariants.filter((invariant) => !invariant.ok))
}

function compactSummary(report) {
  return report.results.map((result) => {
    const commits = result.runs.filter((run) => run.phase === 'commit')
    const pick = (read) => {
      const values = commits
        .map(read)
        .filter((value) => typeof value === 'number')
        .sort((a, b) => a - b)
      return { p50: percentile(values, 50), p95: percentile(values, 95), n: values.length }
    }
    return {
      name: result.name,
      cancelPatchRequests: result.runs
        .filter((run) => run.phase === 'cancel')
        .map((run) => run.requestCount),
      commitPatchRequests: commits.map((run) => run.requestCount),
      pointerDownToFirstPreviewMs: pick((run) => run.phaseTimings?.pointerDownToFirstPreviewMs),
      shellScriptDurationMs: pick((run) => run.shellMetrics?.ScriptDuration),
      shellTaskDurationMs: pick((run) => run.shellMetrics?.TaskDuration),
      iframeLayoutDurationMs: pick((run) => run.iframeMetrics?.LayoutDuration),
      patchRequestToResponseMs: pick((run) => run.phaseTimings?.patchRequestToResponseMs),
      patchRequestToLoadingFinishedMs: pick(
        (run) => run.phaseTimings?.patchRequestToLoadingFinishedMs,
      ),
      patchWaitingMs: pick((run) => run.phaseTimings?.patchWaitingMs),
      patchReceiveMs: pick((run) => run.phaseTimings?.patchReceiveMs),
      patchEncodedDataLength: pick((run) => run.phaseTimings?.patchEncodedDataLength),
      server: {
        durationMs: pick((run) => run.serverPatch?.durationMs),
        loadMs: pick((run) => run.serverPatch?.loadMs),
        applyMs: pick((run) => run.serverPatch?.applyMs),
        validateMs: pick((run) => run.serverPatch?.validateMs),
        persistMs: pick((run) => run.serverPatch?.persistMs),
        notifyMs: pick((run) => run.serverPatch?.notifyMs),
        serializeMs: pick((run) => run.serverPatch?.serializeMs),
        htmlBytes: commits[0]?.serverPatch?.htmlBytes ?? null,
        reusedValidation: commits.every((run) => run.serverPatch?.reusedValidation !== false),
      },
    }
  })
}

function printSummary(report) {
  console.error(
    '\nEditor-drag profile summary (commit runs, after #308–#313 baseline when dist includes that stack)',
  )
  console.error(
    `storage: userData=${report.storage?.userData?.fsType || '?'} ephemeral=${report.storage?.userData?.ephemeral} path=${report.storage?.userData?.path}`,
  )
  console.error(
    `         workspaces=${report.storage?.workspaces?.fsType || '?'} ephemeral=${report.storage?.workspaces?.ephemeral} path=${report.storage?.workspaces?.path}`,
  )
  for (const entry of report.summary || []) {
    const line = (label, stat) =>
      `${label.padEnd(34)} p50=${stat?.p50 ?? 'n/a'} p95=${stat?.p95 ?? 'n/a'} n=${stat?.n ?? 0}`
    console.error(`\n${entry.name}`)
    console.error(`  ${line('pointerDown→first preview ms', entry.pointerDownToFirstPreviewMs)}`)
    console.error(`  ${line('shell ScriptDuration ms', entry.shellScriptDurationMs)}`)
    console.error(`  ${line('shell TaskDuration ms', entry.shellTaskDurationMs)}`)
    console.error(`  ${line('iframe LayoutDuration ms', entry.iframeLayoutDurationMs)}`)
    console.error(`  ${line('PATCH TTFB ms', entry.patchRequestToResponseMs)}`)
    console.error(`  ${line('PATCH loadingFinished ms', entry.patchRequestToLoadingFinishedMs)}`)
    console.error(`  ${line('PATCH waiting (TTFB-send) ms', entry.patchWaitingMs)}`)
    console.error(`  ${line('PATCH receive body ms', entry.patchReceiveMs)}`)
    console.error(`  ${line('server total ms', entry.server.durationMs)}`)
    console.error(`  ${line('  load ms', entry.server.loadMs)}`)
    console.error(`  ${line('  applyDeckPatches ms', entry.server.applyMs)}`)
    console.error(`  ${line('  extra validate ms', entry.server.validateMs)}`)
    console.error(`  ${line('  persist ms', entry.server.persistMs)}`)
    console.error(`  ${line('  notify (thumbnails) ms', entry.server.notifyMs)}`)
    console.error(`  ${line('  serialize/json ms', entry.server.serializeMs)}`)
    console.error(
      `  htmlBytes=${entry.server.htmlBytes} reusedValidation=${entry.server.reusedValidation} cancelPatches=${entry.cancelPatchRequests.join(',')} commitPatches=${entry.commitPatchRequests.join(',')}`,
    )
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const cases = await buildCases()
  for (const name of options.cases) {
    if (!cases[name])
      throw new Error(`Unknown case ${name}; choose from ${Object.keys(cases).join(', ')}`)
  }

  if (!process.env.DISPLAY && process.platform === 'linux' && options.headed) {
    throw new Error(
      'No DISPLAY is available. Remove --headed to use the automatic xvfb-run wrapper.',
    )
  }
  if (!path.isAbsolute(electronBinary))
    throw new Error(`Electron binary is missing: ${electronBinary}`)
  if (
    !(await readFile(path.join(desktop, 'dist/main/main.js'))
      .then(() => true)
      .catch(() => false))
  ) {
    throw new Error('Built desktop artifacts are missing. Run `pnpm build` before profiling.')
  }

  if (options.output && !options.artifactsDir) {
    options.artifactsDir = path.dirname(path.resolve(options.output))
  }
  if (options.artifactsDir) {
    options.artifactsDir = path.resolve(options.artifactsDir)
    await mkdir(options.artifactsDir, { recursive: true })
  }
  if ((options.cpuProfile || options.heapSnapshot) && !options.artifactsDir) {
    options.artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'ark-editor-profile-artifacts-'))
    console.error(`Writing CPU/heap artifacts to ${options.artifactsDir}`)
  }

  const session = await launchElectron(options)
  const report = {
    benchmark: 'editor-drag-profile',
    issue: 291,
    baseline:
      'after #308–#313 when desktop dist is rebuilt from that stack; this script itself is measurement-only',
    generatedAt: new Date().toISOString(),
    storage: session.storage,
    electron: {
      cdpPort: session.port,
      inspectPort: session.inspectPort,
      userDataDir: session.profileDirectory,
      workspacesDir: session.workspacesDirectory,
      cases: options.cases,
      runs: options.runs,
      steps: options.steps,
      trace: options.trace,
      undo: options.undo,
      cpuProfile: options.cpuProfile,
      heapSnapshot: options.heapSnapshot,
      artifactsDir: options.artifactsDir,
    },
    results: [],
  }
  try {
    for (const name of options.cases) {
      console.error(
        `Profiling ${name} (${options.runs} warmed run${options.runs === 1 ? '' : 's'})...`,
      )
      report.results.push(await runCase(session, { name, ...cases[name] }, options))
    }
  } finally {
    await session.close()
  }

  const failures = flattenInvariantFailures(report)
  report.invariants = { passed: failures.length === 0, failures }
  report.summary = compactSummary(report)
  printSummary(report)
  const json = JSON.stringify(report, null, 2)
  if (options.output) await writeFile(path.resolve(options.output), `${json}\n`, 'utf8')
  console.log(json)
  if (failures.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})

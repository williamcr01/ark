# Editor-drag performance profiling

Measurement for issue #291 (manual editor `POST /api/decks/:id/patch` latency). This is a developer harness, not a CI gate.

**Baselines in this document and in `profile:editor-drag` reports are after #308–#313** (editable-scan skip, http(s) precheck, JSDOM pool, nested-slide precheck, runtime-asset precheck, `journal_mode=PERSIST`). Rebuild desktop `dist` from that stack before comparing numbers. This measurement tooling does not re-ship those wins.

## What already existed

| Tool                       | What it measures                                                                                                                                           | What it cannot see                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm profile:editor-drag` | Real Electron + Chromium DevTools Protocol: pointer-down→first preview, shell/iframe Performance metrics, timeline traces, PATCH TTFB, cancel=0 / commit=1 | Phase split inside apply/persist; Chromium CPU stacks; heap; whether userData is tmpfs/overlay vs a real disk |
| `pnpm bench:editor-patch`  | Node-only `applyDeckPatches` + live-DOM validation                                                                                                         | HTTP, SQLite persist, Chromium loopback JSON, Electron userData                                               |
| Structured logs            | `http.request.completed`, `deck.validation.completed`                                                                                                      | Load / apply / persist / serialize on the PATCH route                                                         |

The overlay/tmpfs Electron harness historically reported PATCH ~100 ms with persist ~2 ms and **cannot reproduce** the ticket’s 451.7 ms route number. Prefer a real-disk `--user-data-dir` (and `--workspaces-dir`) when the question is drag/patch latency on spinning or fsyncing storage.

## Commands

Build first (`pnpm build`). Then:

```bash
# Default: ephemeral tmpdir userData + <userData>/workspaces (often overlay/tmpfs)
pnpm profile:editor-drag -- --case absolute-500 --runs 5 --output /tmp/ark-profile.json

# Chromium + Electron-main V8 CPU profiles (and heap snapshots after commits)
pnpm profile:editor-drag -- --case absolute-500 --runs 3 --cpu-profile --heap-snapshot \
  --output /tmp/ark-profile.json --artifacts-dir /tmp/ark-profile-artifacts

# Pin storage to a real disk (required to study persist / fsync)
pnpm profile:editor-drag -- --case absolute-500 --runs 5 \
  --user-data-dir /mnt/ark-disk/userData \
  --workspaces-dir /mnt/ark-disk/workspaces \
  --cpu-profile --output /mnt/ark-disk/ark-profile.json
```

Equivalent env vars: `ARK_PROFILE_USER_DATA_DIR`, `ARK_PROFILE_WORKSPACES_DIR`, `ARK_PROFILE_CDP_PORT`, `ARK_PROFILE_INSPECT_PORT`. Some containers also need `ELECTRON_DISABLE_SANDBOX=1`.

On Linux without `DISPLAY`, the script wraps Electron in `xvfb-run` (or `--headless=new` if Xvfb is missing).

`--keep-profile` leaves the user-data directory in place. `--no-trace` skips the Tracing domain.

## What the upgraded harness records

Chromium (renderer shell + sandbox iframe) via `--remote-debugging-port` / CDP:

- Injected `__arkEditorProfile`: pointer-down → first live-transform preview, overlay mutations, rAF, long tasks
- `Performance.getMetrics` deltas (Script/Task/Layout/RecalcStyle, heap, nodes)
- Tracing categories: `devtools.timeline`, `blink.user_timing`, `disabled-by-default-devtools.timeline`, `.frame`, `.stack`, `disabled-by-default-network`
- Network: PATCH TTFB (`requestWillBeSent` → `responseReceived`), **loadingFinished** (full body), ResourceTiming waiting/receive, `encodedDataLength`
- Optional `Profiler.start` / `Profiler.stop` (`.cpuprofile` in `--artifacts-dir`)
- Optional `HeapProfiler.takeHeapSnapshot` after each commit

Electron main (Node inspector `--inspect`, when `--cpu-profile` is set):

- V8 CPU profile of the process that runs Express + JSDOM + SQLite persist

Server logs (no API contract change; PATCH JSON is unchanged):

- `deck.patch.completed` with `loadMs`, `applyMs`, `validateMs`, `persistMs`, `notifyMs`, `serializeMs`, `htmlBytes`, `reusedValidation`

`applyMs` includes live-DOM validation inside `applyDeckPatches`. `validateMs` is the extra route-level pass and should be ~0 when validation is reused. `notifyMs` is thumbnail scheduling; editor patches still defer warming by 250 ms and must stay off the pointer-up critical path.

The report JSON includes `storage.userData` / `storage.workspaces` (`fsType`, `mount`, `ephemeral`) and a `summary` block with warmed p50/p95. A compact table is also printed on stderr.

Open `.cpuprofile` / `.heapsnapshot` in Chromium DevTools (Performance / Memory) or `chrome://tracing` for timeline dumps if you add them later.

## Real disk vs overlay

Electron `--user-data-dir` used to control only Chromium userData. Workspace `.ark` files default to `Documents/Ark` unless `ARK_WORKSPACES_DIR` is set. The profiler now:

1. Sets `ARK_WORKSPACES_DIR` to `--workspaces-dir` or `<user-data-dir>/workspaces`
2. Relies on Electron main **honoring** that env when Settings has no custom directory

On Cloud VMs the whole root is often `overlay`. Persist will look fast (~2 ms) and PATCH will not match a laptop SSD/HDD. To force a disk-like path (example, needs loop-mount privileges):

```bash
truncate -s 256M /tmp/ark-disk.img
mkfs.ext4 -F /tmp/ark-disk.img
mkdir -p /tmp/ark-slow-mnt
sudo mount -o loop,sync /tmp/ark-disk.img /tmp/ark-slow-mnt
pnpm profile:editor-drag -- --case absolute-500 --runs 5 \
  --user-data-dir /tmp/ark-slow-mnt/userData \
  --workspaces-dir /tmp/ark-slow-mnt/workspaces \
  --cpu-profile --output /tmp/ark-slow-mnt/ark-profile.json
```

If `storage.workspaces.ephemeral` is `true` in the report, do not treat persist timings as the ticket’s disk-bound gap.

## Interpreting PATCH vs `bench:editor-patch`

`bench:editor-patch` is apply + validation only. The Electron PATCH path also does `getDeck`, SQLite `updateDocument` (document + history, `synchronous=FULL`), and `response.json` of the full deck HTML.

Chromium `patchRequestToResponseMs` is TTFB (server think time + headers). `patchRequestToLoadingFinishedMs` includes downloading the JSON body. `serverPatch.applyMs` / `persistMs` / `serializeMs` split the Node side without changing the HTTP response shape.

A leaner PATCH response (omit full `deck.html`) would be a **Frontend/Backend API contract change** and is out of scope for this measurement work. If loadingFinished ≫ TTFB and `htmlBytes` dominates, that contract hole is the next discussion — do not invent a new response.

## Invariants (unchanged)

- Cancelled gestures: zero PATCH requests, revision unchanged
- Committed gestures: exactly one PATCH, revision increments
- Thumbnail warming stays deferred on editor patches
- Live compositor previews stay off pointer-up
- Validation and document-revision conflict semantics unchanged

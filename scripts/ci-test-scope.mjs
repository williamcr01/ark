#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const workspacePath =
  /^(apps\/(api|mcp|sandbox|desktop)|packages\/(agent|ai|chat|contracts|deck|deck-preview|editor-runtime|mcp|runtime-registry|storage|telemetry))\//
const documentationPath =
  /(^|\/)(README|AGENTS|CLAUDE|CONTRIBUTING|CHANGELOG|LICENSE|NOTICE)(\.[^/]*)?$|\.md$/i
const testOnlyPath = /(^|\/)(test|tests|__tests__)\/|[./](test|spec)\.[cm]?[jt]sx?$/

const forceFullPaths = [
  /^\.github\//,
  /^test\/fixtures\//,
  /^runtimes\//,
  /^openapi\//,
  /^scripts\//,
  /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/,
  /(^|\/)(tsconfig(?:\.[^/]*)?\.json|vitest\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s)$/,
  /^(eslint\.config\.[cm]?[jt]s|\.oxlintrc\.json|\.prettier[^/]*|prettier\.config\.[cm]?[jt]s)$/,
  /^apps\/desktop\/src\/test\/setup\.ts$/,
]

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '')
}

function isDocumentation(filePath) {
  return (
    filePath.startsWith('docs/') ||
    filePath.startsWith('agent-guides/') ||
    documentationPath.test(filePath)
  )
}

function isForceFull(filePath) {
  return forceFullPaths.some((pattern) => pattern.test(filePath))
}

export function classifyPaths(inputPaths, options = {}) {
  const paths = [...new Set(inputPaths.map(normalizePath).filter(Boolean))].sort()

  if (options.forceFullReason) {
    return {
      paths,
      full: true,
      build: true,
      test: true,
      smoke: true,
      reason: options.forceFullReason,
    }
  }

  if (paths.length === 0) {
    return {
      paths,
      full: true,
      build: true,
      test: true,
      smoke: true,
      reason: 'No changed paths were detected; using the safe full-suite fallback.',
    }
  }

  const highRiskPath = paths.find(isForceFull)
  if (highRiskPath) {
    return {
      paths,
      full: true,
      build: true,
      test: true,
      smoke: true,
      reason: `High-risk or shared CI input changed: ${highRiskPath}`,
    }
  }

  const relevantPaths = paths.filter((filePath) => !isDocumentation(filePath))

  if (relevantPaths.length === 0) {
    return {
      paths,
      full: false,
      build: false,
      test: false,
      smoke: false,
      reason: 'Only documentation or agent-guide files changed.',
    }
  }

  const unknownPath = relevantPaths.find((filePath) => !workspacePath.test(filePath))
  if (unknownPath) {
    return {
      paths,
      full: true,
      build: true,
      test: true,
      smoke: true,
      reason: `Unclassified path changed: ${unknownPath}`,
    }
  }

  const runtimePath = relevantPaths.find((filePath) => !testOnlyPath.test(filePath))
  return {
    paths,
    full: false,
    build: true,
    test: true,
    smoke: Boolean(runtimePath),
    reason: runtimePath
      ? `Runtime workspace code changed: ${runtimePath}`
      : 'Only workspace tests changed; desktop smoke is not required.',
  }
}

function parseArguments(argv) {
  const parsed = { base: '', output: '', summary: '', forceFullReason: '', paths: [] }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const value = argv[index + 1]

    if (argument === '--base' && value) {
      parsed.base = value
      index += 1
    } else if (argument === '--github-output' && value) {
      parsed.output = value
      index += 1
    } else if (argument === '--github-summary' && value) {
      parsed.summary = value
      index += 1
    } else if (argument === '--full-reason' && value) {
      parsed.forceFullReason = value
      index += 1
    } else if (argument === '--path' && value) {
      parsed.paths.push(value)
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }

  return parsed
}

export function changedPathsSince(base, cwd = process.cwd()) {
  if (!base) {
    throw new Error('--base is required unless --full-reason is provided')
  }

  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '--diff-filter=ACMRD', '-z', `${base}...HEAD`],
    { cwd, encoding: 'buffer' },
  )

  return output.toString('utf8').split('\0').filter(Boolean)
}

function writeOutputs(filePath, result) {
  if (!filePath) return

  appendFileSync(
    filePath,
    [
      `full=${String(result.full)}`,
      `build=${String(result.build)}`,
      `test=${String(result.test)}`,
      `smoke=${String(result.smoke)}`,
      `reason=${result.reason.replaceAll('\n', ' ')}`,
      '',
    ].join('\n'),
  )
}

function writeSummary(filePath, result) {
  if (!filePath) return

  const pathList =
    result.paths.length > 0
      ? result.paths.map((filePath) => `- \`${filePath.replaceAll('`', '\\`')}\``).join('\n')
      : '- Full validation was requested without path classification.'

  appendFileSync(
    filePath,
    [
      '## CI scope',
      '',
      `- Full validation: **${result.full ? 'yes' : 'no'}**`,
      `- Build: **${result.build ? 'run' : 'skip'}**`,
      `- Unit tests: **${result.test ? (result.full ? 'full' : 'affected') : 'skip'}**`,
      `- Desktop smoke: **${result.smoke ? 'run' : 'skip'}**`,
      `- Reason: ${result.reason}`,
      '',
      '<details><summary>Changed paths</summary>',
      '',
      pathList,
      '',
      '</details>',
      '',
    ].join('\n'),
  )
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const paths =
    options.paths.length > 0
      ? options.paths
      : options.forceFullReason
        ? []
        : changedPathsSince(options.base)
  const result = classifyPaths(paths, { forceFullReason: options.forceFullReason })

  writeOutputs(options.output, result)
  writeSummary(options.summary, result)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

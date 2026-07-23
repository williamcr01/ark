#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { relative } from 'node:path'

const workspaceKinds = new Map([
  ['apps/api', 'app'],
  ['apps/sandbox', 'app'],
  ['apps/web', 'app'],
  ['packages/contracts', 'package'],
  ['packages/deck-core', 'package'],
  ['packages/runtime-registry', 'package'],
])

function parseArguments(argv) {
  const parsed = { base: '', summary: '' }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const value = argv[index + 1]

    if (argument === '--base' && value) {
      parsed.base = value
      index += 1
    } else if (argument === '--github-summary' && value) {
      parsed.summary = value
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }

  if (!parsed.base) {
    throw new Error('--base is required')
  }

  return parsed
}

function resolveAffectedWorkspaces(base) {
  const output = execFileSync(
    'pnpm',
    ['--filter', `...[${base}]`, 'list', '--depth', '-1', '--json'],
    { encoding: 'utf8' },
  )
  const projects = JSON.parse(output)

  return projects
    .map((project) => {
      const workspace = relative(process.cwd(), project.path).replaceAll('\\', '/')
      const kind = workspaceKinds.get(workspace)

      if (!kind || !project.name) {
        throw new Error(`pnpm selected an unknown workspace: ${workspace || project.path}`)
      }

      return { name: project.name, workspace, kind }
    })
    .sort((left, right) => left.workspace.localeCompare(right.workspace))
}

function runWorkspaceTests(projects, kind) {
  const selected = projects.filter((project) => project.kind === kind)
  if (selected.length === 0) return

  const filters = selected.flatMap((project) => ['--filter', project.name])
  const argumentsForKind =
    kind === 'package'
      ? ['--parallel', ...filters, 'test']
      : ['-r', '--workspace-concurrency=1', ...filters, 'test']
  const result = spawnSync('pnpm', argumentsForKind, { stdio: 'inherit' })

  if (result.error) throw result.error
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function writeSummary(filePath, projects, base) {
  if (!filePath) return

  const selected =
    projects.length > 0
      ? projects.map((project) => `- \`${project.name}\` (${project.workspace})`).join('\n')
      : '- No affected workspace tests were selected.'

  appendFileSync(
    filePath,
    ['### Affected test workspaces', '', `Compared with base \`${base}\`:`, '', selected, ''].join(
      '\n',
    ),
  )
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const projects = resolveAffectedWorkspaces(options.base)

  writeSummary(options.summary, projects, options.base)

  if (projects.length === 0) {
    throw new Error('Tests were requested, but pnpm selected no affected workspaces')
  }

  process.stdout.write(
    `Affected workspaces: ${projects.map((project) => project.name).join(', ')}\n`,
  )
  runWorkspaceTests(projects, 'package')
  runWorkspaceTests(projects, 'app')
}

main()

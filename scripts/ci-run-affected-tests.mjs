#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const workspaceProjects = new Map([
  ['apps/api', '@ark/api-*'],
  ['apps/mcp', '@ark/mcp-server'],
  ['apps/sandbox', '@ark/sandbox'],
  ['apps/desktop', '@ark/desktop-*'],
  ['packages/contracts', '@ark/contracts'],
  ['packages/agent', '@ark/agent'],
  ['packages/ai', '@ark/ai'],
  ['packages/chat', '@ark/chat'],
  ['packages/deck', '@ark/deck'],
  ['packages/deck-export', '@ark/deck-export'],
  ['packages/deck-preview', '@ark/deck-preview'],
  ['packages/editor-runtime', '@ark/editor-runtime'],
  ['packages/mcp', '@ark/mcp'],
  ['packages/runtime-registry', '@ark/runtime-registry'],
  ['packages/storage', '@ark/storage'],
  ['packages/telemetry', '@ark/telemetry'],
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
      if (!workspace) return null

      const vitestProject = workspaceProjects.get(workspace)

      if (!vitestProject || !project.name) {
        throw new Error(`pnpm selected an unknown workspace: ${workspace || project.path}`)
      }

      return { name: project.name, workspace, project: vitestProject }
    })
    .filter(Boolean)
    .sort((left, right) => left.workspace.localeCompare(right.workspace))
}

function runWorkspaceTests(projects) {
  const projectFilters = projects.flatMap(({ project }) => ['--project', project])
  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', ...projectFilters],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_COMPILE_CACHE:
          process.env.NODE_COMPILE_CACHE ?? resolve('node_modules/.cache/ark-test-compile'),
      },
    },
  )

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
  runWorkspaceTests(projects)
}

main()

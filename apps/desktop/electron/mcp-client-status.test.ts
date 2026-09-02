import { describe, expect, it } from 'vitest'

import {
  argsIncludeMcpFlags,
  buildCliAddArgs,
  buildCliDetectCommands,
  buildCliRemoveArgs,
  detectArkInstallationStatus,
  extractArkInvocation,
  parseCliServerOutput,
  sameExecutablePath,
  splitExecutableArgs,
} from './mcp-client-status.ts'

const expectedCommand = '/Applications/Ark.app/Contents/MacOS/Ark'

describe('MCP client status helpers', () => {
  it('splits the packaged executable from MCP flags', () => {
    expect(splitExecutableArgs([expectedCommand, '--headless', '--mcp'])).toEqual({
      command: expectedCommand,
      args: ['--headless', '--mcp'],
    })
    expect(argsIncludeMcpFlags(['--headless', '/repo/apps/desktop', '--mcp'])).toBe(true)
    expect(argsIncludeMcpFlags(['--headless'])).toBe(false)
  })

  it('detects installed, needsUpdate, and notInstalled from command and flags', () => {
    expect(
      detectArkInstallationStatus({
        expectedCommand,
        actual: { present: false },
        platform: 'darwin',
      }),
    ).toBe('notInstalled')
    expect(
      detectArkInstallationStatus({
        expectedCommand,
        actual: { present: true, command: expectedCommand, args: ['--headless', '--mcp'] },
        platform: 'darwin',
      }),
    ).toBe('installed')
    expect(
      detectArkInstallationStatus({
        expectedCommand,
        actual: {
          present: true,
          command: expectedCommand,
          args: ['--headless', '/repo/apps/desktop', '--mcp'],
        },
        platform: 'linux',
      }),
    ).toBe('installed')
    expect(
      detectArkInstallationStatus({
        expectedCommand,
        actual: {
          present: true,
          command: '/old/Ark.app/Contents/MacOS/Ark',
          args: ['--headless', '--mcp'],
        },
        platform: 'darwin',
      }),
    ).toBe('needsUpdate')
    expect(
      detectArkInstallationStatus({
        expectedCommand,
        actual: { present: true, command: expectedCommand, args: ['--mcp'] },
        platform: 'darwin',
      }),
    ).toBe('needsUpdate')
  })

  it('compares Windows executable paths case-insensitively', () => {
    expect(
      sameExecutablePath(
        'C:\\Program Files\\Ark\\Ark.exe',
        'c:\\program files\\ark\\ark.exe',
        'win32',
      ),
    ).toBe(true)
  })

  it('builds CLI add, remove, and detect argument arrays without a shell string', () => {
    const executableArgs = [expectedCommand, '--headless', '--mcp']
    expect(buildCliAddArgs('codex', executableArgs)).toEqual([
      'mcp',
      'add',
      'ark',
      '--',
      ...executableArgs,
    ])
    expect(buildCliAddArgs('claudeCode', executableArgs)).toEqual([
      'mcp',
      'add',
      '--transport',
      'stdio',
      '--scope',
      'user',
      'ark',
      '--',
      ...executableArgs,
    ])
    expect(buildCliAddArgs('grok', executableArgs)).toEqual([
      'mcp',
      'add',
      'ark',
      '--',
      ...executableArgs,
    ])
    expect(buildCliAddArgs('devinCli', executableArgs)).toEqual([
      'mcp',
      'add',
      '-s',
      'user',
      'ark',
      '--',
      ...executableArgs,
    ])
    expect(buildCliRemoveArgs('codex')).toEqual(['mcp', 'remove', 'ark'])
    expect(buildCliRemoveArgs('claudeCode')).toEqual(['mcp', 'remove', 'ark', '--scope', 'user'])
    expect(buildCliRemoveArgs('grok')).toEqual(['mcp', 'remove', 'ark'])
    expect(buildCliRemoveArgs('devinCli')).toEqual(['mcp', 'remove', 'ark', '-s', 'user'])
    expect(buildCliDetectCommands('codex')[0]).toEqual(['mcp', 'get', 'ark', '--json'])
    expect(buildCliDetectCommands('grok')[0]).toEqual(['mcp', 'list', '--json'])
  })

  it('extracts ark command and args from nested CLI JSON shapes', () => {
    expect(
      extractArkInvocation({
        name: 'ark',
        transport: { type: 'stdio', command: expectedCommand, args: ['--headless', '--mcp'] },
      }),
    ).toEqual({ present: true, command: expectedCommand, args: ['--headless', '--mcp'] })
    expect(
      extractArkInvocation({
        mcpServers: { ark: { command: expectedCommand, args: ['--headless', '--mcp'] } },
      }),
    ).toEqual({ present: true, command: expectedCommand, args: ['--headless', '--mcp'] })
    expect(
      extractArkInvocation({
        mcp: { ark: { command: [expectedCommand, '--headless', '--mcp'] } },
      }),
    ).toEqual({ present: true, command: expectedCommand, args: ['--headless', '--mcp'] })
    expect(
      extractArkInvocation([
        { name: 'github', command: 'npx' },
        { name: 'ark', command: expectedCommand },
      ]),
    ).toEqual({ present: true, command: expectedCommand, args: [] })
    expect(extractArkInvocation({ servers: [] })).toEqual({ present: false })
  })

  it('parses JSON and text CLI output and treats missing-server errors as absent', () => {
    expect(
      parseCliServerOutput(
        JSON.stringify({
          name: 'ark',
          command: expectedCommand,
          args: ['--headless', '--mcp'],
        }),
      ),
    ).toEqual({ present: true, command: expectedCommand, args: ['--headless', '--mcp'] })
    expect(parseCliServerOutput('', 'No MCP server named ark')).toEqual({ present: false })
    expect(
      parseCliServerOutput(`ark
  command: ${expectedCommand}
  args: --headless --mcp
`),
    ).toEqual({ present: true, command: expectedCommand, args: ['--headless', '--mcp'] })
  })
})

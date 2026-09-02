#!/usr/bin/env node

/**
 * Inventory of desktop renderer structure-budget offenders.
 *
 * Warns (exit 0) when an exported `*Props` type/interface has more than 12 fields,
 * or an `export function use*` returns an object literal with more than 10 keys.
 * Pass `--strict` to exit 1 when any offender is found.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const ts = require('typescript')

const SRC = path.join(root, 'apps/desktop/src')
const MAX_PROPS_FIELDS = 12
const MAX_HOOK_RETURN_KEYS = 10

export const STRUCTURE_LIMITS = { MAX_PROPS_FIELDS, MAX_HOOK_RETURN_KEYS }

function listSourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listSourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function isExported(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function countTypeMembers(members) {
  return members.filter(
    (member) =>
      ts.isPropertySignature(member) ||
      ts.isMethodSignature(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member) ||
      ts.isCallSignatureDeclaration(member) ||
      ts.isConstructSignatureDeclaration(member) ||
      ts.isIndexSignatureDeclaration(member),
  ).length
}

function countFields(typeNode) {
  if (!typeNode) return 0
  if (ts.isTypeLiteralNode(typeNode)) return countTypeMembers(typeNode.members)
  if (ts.isParenthesizedTypeNode(typeNode)) return countFields(typeNode.type)
  if (ts.isIntersectionTypeNode(typeNode)) {
    return typeNode.types.reduce((total, part) => total + countFields(part), 0)
  }
  return 0
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function isNestedFunction(node, hook) {
  return (
    node !== hook &&
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node))
  )
}

function collectPropsOffenders(sourceFile, filePath) {
  const found = []
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && isExported(node) && node.name.text.endsWith('Props')) {
      const count = countTypeMembers(node.members)
      if (count > MAX_PROPS_FIELDS) {
        found.push({
          kind: 'props',
          file: filePath,
          name: node.name.text,
          count,
          line: lineOf(sourceFile, node),
        })
      }
    }
    if (ts.isTypeAliasDeclaration(node) && isExported(node) && node.name.text.endsWith('Props')) {
      const count = countFields(node.type)
      if (count > MAX_PROPS_FIELDS) {
        found.push({
          kind: 'props',
          file: filePath,
          name: node.name.text,
          count,
          line: lineOf(sourceFile, node),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function hookReturnLiterals(fn, sourceFile) {
  const found = []
  const visit = (node) => {
    if (isNestedFunction(node, fn)) return
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      ts.isObjectLiteralExpression(node.expression)
    ) {
      found.push({
        keys: node.expression.properties.length,
        line: lineOf(sourceFile, node.expression),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(fn)
  return found
}

function collectHookOffenders(sourceFile, filePath) {
  const found = []
  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      isExported(node) &&
      node.name &&
      /^use[A-Z]/.test(node.name.text)
    ) {
      for (const returned of hookReturnLiterals(node, sourceFile)) {
        if (returned.keys > MAX_HOOK_RETURN_KEYS) {
          found.push({
            kind: 'hook-return',
            file: filePath,
            name: node.name.text,
            count: returned.keys,
            line: returned.line,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

export function findStructureOffenders(srcRoot = SRC, repoRoot = root) {
  const offenders = []
  for (const file of listSourceFiles(srcRoot)) {
    const text = readFileSync(file, 'utf8')
    const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind)
    const rel = path.relative(repoRoot, file).replaceAll('\\', '/')
    offenders.push(
      ...collectPropsOffenders(sourceFile, rel),
      ...collectHookOffenders(sourceFile, rel),
    )
  }
  offenders.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name),
  )
  return offenders
}

export function formatStructureReport(offenders) {
  const props = offenders.filter((item) => item.kind === 'props')
  const hooks = offenders.filter((item) => item.kind === 'hook-return')
  const lines = [
    'Structure budget inventory (warnings; use --strict to fail):',
    `  Props types with >${MAX_PROPS_FIELDS} fields: ${props.length}`,
    `  Hooks returning >${MAX_HOOK_RETURN_KEYS} keys: ${hooks.length}`,
  ]
  if (props.length > 0) {
    lines.push('', `Exported *Props with more than ${MAX_PROPS_FIELDS} fields:`)
    for (const item of props) {
      lines.push(`  ${item.file}:${item.line}  ${item.name} (${item.count} fields)`)
    }
  }
  if (hooks.length > 0) {
    lines.push(
      '',
      `export function use* return { ... } with more than ${MAX_HOOK_RETURN_KEYS} keys:`,
    )
    for (const item of hooks) {
      lines.push(`  ${item.file}:${item.line}  ${item.name} (${item.count} keys)`)
    }
  }
  return { lines, props, hooks }
}

export function resolveScanRoots(argv, defaultRoot = root) {
  const rootFlag = argv.find((arg) => arg.startsWith('--root='))
  const scanRoot = rootFlag ? path.resolve(rootFlag.slice('--root='.length)) : defaultRoot
  return {
    repoRoot: scanRoot,
    srcRoot: path.join(scanRoot, 'apps/desktop/src'),
  }
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  const args = process.argv.slice(2)
  const strict = args.includes('--strict')
  const { repoRoot, srcRoot } = resolveScanRoots(args)
  const offenders = findStructureOffenders(srcRoot, repoRoot)
  const { lines } = formatStructureReport(offenders)
  const stream = strict && offenders.length > 0 ? console.error : console.log
  for (const line of lines) stream(line)
  if (strict && offenders.length > 0) process.exit(1)
}

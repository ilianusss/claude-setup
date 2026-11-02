import { describe, expect, test } from 'claude-code/testing'

import { checksFor, testFilesCommands, isWatched } from '../src/checks'
import type { Config } from '../src/config'
import { removedLines } from '../src/lock'

const CONFIG: Config = {
  testGlobs: ['**/*.test.ts'],
  testConfig: [],
  commands: { test: 'pnpm test', testFiles: 'pnpm vitest run {files}', lint: 'pnpm lint', typecheck: 'pnpm tsc --noEmit' },
  testLevel: undefined,
  specsDir: 'docs/specs',
  packages: [],
}

describe('testFilesCommands', () => {
  test('puts the slice test files into the template, sorted', () => {
    expect(testFilesCommands(CONFIG, ['src/b.test.ts', 'src/a.test.ts'])).toEqual(['pnpm vitest run src/a.test.ts src/b.test.ts'])
  })

  test('quotes a path that needs it', () => {
    expect(testFilesCommands(CONFIG, ["src/it's.test.ts"])).toEqual([`pnpm vitest run 'src/it'\\''s.test.ts'`])
  })

  test('falls back to the full suite without a template', () => {
    expect(testFilesCommands({ ...CONFIG, commands: { test: 'pytest' } }, ['tests/test_a.py'])).toEqual(['pytest'])
  })

  test('groups files by package, each with its own template', () => {
    const config: Config = {
      ...CONFIG,
      packages: [{ path: 'apps/api', testGlobs: [], commands: { testFiles: 'pnpm --filter api vitest run {files}' } }],
    }
    expect(testFilesCommands(config, ['apps/api/src/a.test.ts', 'libs/x.test.ts'])).toEqual([
      'pnpm --filter api vitest run apps/api/src/a.test.ts',
      'pnpm vitest run libs/x.test.ts',
    ])
  })
})

describe('checksFor', () => {
  test('lists the slice tests, then lint, typecheck and the full suite', () => {
    expect(checksFor(CONFIG, ['src/a.test.ts'])).toEqual([
      'pnpm vitest run src/a.test.ts',
      'pnpm lint',
      'pnpm tsc --noEmit',
      'pnpm test',
    ])
  })
})

describe('isWatched', () => {
  test('watches the configured commands and any testFiles rendering', () => {
    expect(isWatched(CONFIG, 'pnpm lint')).toBe(true)
    expect(isWatched(CONFIG, 'pnpm vitest run src/x.test.ts')).toBe(true)
    expect(isWatched(CONFIG, 'ls')).toBe(false)
  })

  test('ignores a piped run, whose exit code is the last command of the pipe', () => {
    expect(isWatched(CONFIG, 'pnpm vitest run src/x.test.ts | tail')).toBe(false)
  })
})

describe('removedLines', () => {
  test('lists lines the new version lost', () => {
    expect(removedLines('a\nexpect(x).toBe(1)\nb', 'a\nb\nc')).toEqual(['expect(x).toBe(1)'])
  })

  test('ignores imports, blank lines and pure additions', () => {
    expect(removedLines("import { a } from './a'\n\nexpect(a).toBe(1)", "import { a, b } from './a'\nexpect(a).toBe(1)\nexpect(b).toBe(2)")).toEqual([])
  })

  test('counts a duplicated line once per copy', () => {
    expect(removedLines('x\nx', 'x')).toEqual(['x'])
  })
})

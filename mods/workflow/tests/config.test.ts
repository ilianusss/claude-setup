import { describe, expect, test } from 'claude-code/testing'

import { parseConfig } from '../src/config'

describe('parseConfig', () => {
  test('reads a full config', () => {
    const parsed = parseConfig(
      JSON.stringify({
        testGlobs: ['**/*.test.ts'],
        testConfig: ['vitest.config.ts'],
        commands: { test: 'pnpm test', testFiles: 'pnpm vitest run {files}', lint: 'pnpm lint', typecheck: 'pnpm tsc --noEmit' },
        testLevel: 'personal app',
        specsDir: 'specs',
        packages: [{ path: 'apps/api', commands: { testFiles: 'pnpm --filter api vitest run {files}' } }],
      }),
    )
    expect(parsed).toMatchObject({
      config: {
        testGlobs: ['**/*.test.ts'],
        testConfig: ['vitest.config.ts'],
        specsDir: 'specs',
        packages: [{ path: 'apps/api', testGlobs: [], commands: { testFiles: 'pnpm --filter api vitest run {files}' } }],
      },
    })
  })

  test('fills the defaults', () => {
    const parsed = parseConfig(JSON.stringify({ testGlobs: ['tests/**'], commands: { test: 'pytest' } }))
    expect(parsed).toMatchObject({ config: { testConfig: [], specsDir: 'docs/specs', packages: [] } })
  })

  test('names every problem it finds', () => {
    const parsed = parseConfig(JSON.stringify({ testGlobs: 'tests/**', commands: { lint: 3 } }))
    expect(parsed).toEqual({
      errors: ['testGlobs must be a list of globs', 'commands.test is required', 'commands.lint must be a string'],
    })
  })

  test('reads the command that readies a fresh worktree', () => {
    const parsed = parseConfig(JSON.stringify({ testGlobs: ['tests/**'], commands: { test: 'pytest' }, worktreeSetup: 'uv sync' }))
    expect(parsed).toMatchObject({ config: { worktreeSetup: 'uv sync' } })
  })

  test('has no worktree setup when the config names none', () => {
    const parsed = parseConfig(JSON.stringify({ testGlobs: ['tests/**'], commands: { test: 'pytest' } }))
    expect(parsed).toMatchObject({ config: { worktreeSetup: undefined } })
  })

  test('refuses a worktree setup that is not a string', () => {
    const parsed = parseConfig(JSON.stringify({ testGlobs: ['tests/**'], commands: { test: 'pytest' }, worktreeSetup: ['npm', 'ci'] }))
    expect(parsed).toEqual({ errors: ['worktreeSetup must be a string'] })
  })

  test('refuses invalid JSON', () => {
    expect(parseConfig('{ nope')).toMatchObject({ errors: [expect.stringContaining('not valid JSON')] })
  })
})

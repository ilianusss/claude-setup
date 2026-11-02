import { describe, expect, test } from 'claude-code/testing'

import { matchesAny } from '../src/glob'

const CASES: ReadonlyArray<readonly [glob: string, path: string, matches: boolean]> = [
  ['**/*.{test,spec}.*', 'src/cart.test.ts', true],
  ['**/*.{test,spec}.*', 'cart.spec.js', true],
  ['**/*.{test,spec}.*', 'src/test.ts', false],
  ['**/__tests__/**', 'src/__tests__/cart.ts', true],
  ['**/__tests__/**', '__tests__/a/b.js', true],
  ['**/tests/**', 'tests/test_cart.py', true],
  ['**/tests/**', 'crates/core/tests/cart.rs', true],
  ['**/tests/**', 'src/testsuite/cart.py', false],
  ['**/*_test.go', 'pkg/cart/cart_test.go', true],
  ['**/test_*.py', 'test_cart.py', true],
  ['**/test_*.py', 'app/test_cart.py', true],
  ['docs/specs/**', 'docs/specs/login/spec.md', true],
  ['docs/specs/**', 'docs/adr/x.md', false],
  ['*.md', 'README.md', true],
  ['*.md', 'docs/README.md', false],
  ['.claude/workflow.json', '.claude/workflow.json', true],
  ['src/?.ts', 'src/a.ts', true],
  ['src/?.ts', 'src/ab.ts', false],
]

describe('matchesAny', () => {
  for (const [glob, path, expected] of CASES) {
    test(`${glob} ${expected ? 'matches' : 'does not match'} ${path}`, () => {
      expect(matchesAny(path, [glob])).toBe(expected)
    })
  }
})

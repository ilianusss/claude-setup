import { describe, expect, test } from 'claude-code/testing'

import { addedEmDashes, rewriteEmDashes } from '../src/typography'

const DASH = String.fromCharCode(0x2014)

describe('addedEmDashes', () => {
  test('counts the em dashes the new text adds over the old one', () => {
    expect(addedEmDashes(`a ${DASH} b`, `a ${DASH} b ${DASH} c ${DASH} d`)).toBe(2)
  })

  test('is zero when the new text keeps the existing ones', () => {
    expect(addedEmDashes(`keep ${DASH} this`, `keep ${DASH} this, changed`)).toBe(0)
  })

  test('is zero when the new text removes some', () => {
    expect(addedEmDashes(`${DASH}${DASH}`, 'none')).toBe(0)
  })
})

describe('rewriteEmDashes', () => {
  test('turns a spaced em dash into a spaced hyphen', () => {
    expect(rewriteEmDashes(`one ${DASH} two`)).toBe('one - two')
  })

  test('turns an unspaced em dash into a spaced hyphen', () => {
    expect(rewriteEmDashes(`one${DASH}two`)).toBe('one - two')
  })

  test('leaves line breaks around it alone', () => {
    expect(rewriteEmDashes(`end ${DASH}\nnext`)).toBe('end -\nnext')
  })

  test('leaves text without em dash unchanged', () => {
    expect(rewriteEmDashes('a - b, c: d (e)')).toBe('a - b, c: d (e)')
  })
})

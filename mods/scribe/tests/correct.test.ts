import { describe, expect, test } from 'claude-code/testing'

import { describeChanges, isSafeCorrection } from '../src/correct'

const DASH = String.fromCharCode(0x2014)

describe('describeChanges', () => {
  test('pairs each replaced word with its correction, in order', () => {
    expect(describeChanges('can you fix teh login page pls', 'can you fix the login page please')).toBe('teh → the, pls → please')
  })

  test('groups neighbouring replaced words into one change', () => {
    expect(describeChanges('i dont no why', "I don't know why")).toBe("i dont no → I don't know")
  })

  test('marks an added word with a plus and a removed word with a minus', () => {
    expect(describeChanges('run the the tests', 'run the tests now')).toBe('-the, +now')
  })

  test('cuts a long list to 80 characters', () => {
    const original = Array.from({ length: 30 }, (_, i) => `wrd${i}`).join(' ')
    const corrected = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' x ')
    const changes = describeChanges(original, corrected)
    expect(changes.length).toBe(80)
    expect(changes.endsWith('…')).toBe(true)
  })
})

describe('isSafeCorrection', () => {
  test('accepts a fix of spelling and grammar', () => {
    expect(isSafeCorrection('i dont no why teh build fails', "I don't know why the build fails")).toBe(true)
  })

  test('refuses an empty correction', () => {
    expect(isSafeCorrection('can you fix teh login page', '')).toBe(false)
  })

  test('refuses a correction more than a quarter longer, such as an answer', () => {
    expect(isSafeCorrection('whats a mod', 'A mod is a TypeScript module that hooks into Claude Code.')).toBe(false)
  })

  test('refuses a correction more than a quarter shorter', () => {
    expect(isSafeCorrection('can you please fix the login page and the signup page', 'fix the login page')).toBe(false)
  })

  test('refuses a correction that changes inline code', () => {
    expect(isSafeCorrection('rename `getUsr` to somthing better', 'rename `getUser` to something better')).toBe(false)
  })

  test('refuses a correction that changes a fenced code block', () => {
    expect(isSafeCorrection('why dose this fail\n```\nconst x = fucntion()\n```', 'why does this fail\n```\nconst x = function()\n```')).toBe(false)
  })

  test('refuses a correction that changes a path', () => {
    expect(isSafeCorrection('look at src/auth/tokn.ts pls', 'look at src/auth/token.ts please')).toBe(false)
  })

  test('accepts punctuation added after a path', () => {
    expect(isSafeCorrection('look at teh file src/auth/tokn.ts', 'look at the file src/auth/tokn.ts.')).toBe(true)
  })

  test('refuses a correction that changes a URL', () => {
    expect(isSafeCorrection('read https://exmaple.com/docs first', 'read https://example.com/docs first')).toBe(false)
  })

  test('refuses a correction that changes an @mention', () => {
    expect(isSafeCorrection('explain @src/indx.ts to me', 'explain @src/index.ts to me')).toBe(false)
  })

  test('refuses a correction that adds an em dash', () => {
    expect(isSafeCorrection('fix it, then run teh tests', `fix it ${DASH} then run the tests`)).toBe(false)
  })

  test('accepts an em dash the prompt already had', () => {
    expect(isSafeCorrection(`fix it ${DASH} then run teh tests`, `fix it ${DASH} then run the tests`)).toBe(true)
  })
})

import type { Phase } from './state'

export const SIZE = {
  question: (title: string) => `How big is "${title}"?`,
  feature: 'Feature: several slices in an existing project',
  project: 'Project: a new product or a large feature',
}

export const COMMITS = {
  question: 'Commit after each verified slice?',
  yes: 'Yes, commit each slice',
  no: 'No, I commit myself',
}

export const CHAINING = {
  question: 'Start the next slice without asking, once a slice is verified?',
  yes: 'Yes, go straight on',
  no: 'No, ask me after each slice',
}

export const NEXT_SLICE = {
  question: (slug: string, verified: number) => `Slice ${verified} of "${slug}" is verified. Start slice ${verified + 1} now?`,
  start: (slice: number) => `Start slice ${slice}`,
  stop: 'Stop here',
}

export const BRANCH = {
  create: (branch: string) => `Create ${branch}`,
  stay: (branch: string) => `Stay on ${branch}`,
}

export const SWITCH = {
  yes: (branch: string) => `Switch to ${branch}`,
  no: 'Cancel',
}

export const MODELS = {
  question: 'Which models should the steps use?',
  defaults: 'Use the defaults',
  recommended: "Use Claude's recommendations",
  perStep: 'Choose per step',
}

export const PICKER = {
  title: 'Models',
  use: 'Use these',
  reset: 'Reset to recommended',
  cancel: 'Cancel',
  recommended: 'recommended',
  dialogRecommended: '(Recommended)',
  dialogDefault: '(default)',
}

export const GATE = { continue: 'Continue', stop: 'Stop here', wait: 'Not yet' }
export const UNLOCK = { yes: 'Unlock', no: 'Keep locked' }
export const RETRO = { run: 'Run the retro first', close: 'Close now' }
export const ADOPT = { rebuild: 'Rebuild it', skip: 'Skip' }

const IGNORED_SHOWN = 5

function ignoredNote(ignored: readonly string[]): string {
  if (ignored.length === 0) return ''
  const shown = ignored.slice(0, IGNORED_SHOWN).join(', ')
  const more = ignored.length > IGNORED_SHOWN ? ` and ${ignored.length - IGNORED_SHOWN} more` : ''
  return ` Its ignored files are deleted with it: ${shown}${more}.`
}

export const ENDING = {
  question: (worktree: string, branch: string, ignored: readonly string[] = []) =>
    `Remove the worktree ${worktree} and the local branch ${branch}? The worktree has no uncommitted change and the branch is pushed.${ignoredNote(ignored)}`,
  remove: 'Remove them',
  keep: 'Keep them',
}

export const PRODUCES: Readonly<Record<Exclude<Phase, 'done'>, string>> = {
  intake: 'the goal of this workflow, agreed with the user',
  setup: '.claude/workflow.json, the project CLAUDE.md and its settings',
  spec: 'spec.md: the product, for whom, and its acceptance criteria',
  design: 'design.md: the options, the chosen one and why',
  slice: 'slices.md: the work cut into slices that each ship on their own',
  build: 'each slice, built test-first with its tests locked',
  inspect: 'a review of the branch, the fixes the user picks and a pull request draft',
  retro: 'small changes to the setup, from what this workflow taught',
}

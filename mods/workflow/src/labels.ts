import type { Phase } from './state'

export const SIZE = {
  question: (title: string) => `How big is "${title}"?`,
  feature: 'Feature: several slices in an existing project',
  project: 'Project: a new product or a large feature',
}

export const PROMPTING = {
  question: 'Be asked about every decision, or only the major ones?',
  all: 'Every decision',
  major: 'Only the major ones',
}

export const TECHNICAL = {
  question: 'Be asked about technical decisions?',
  yes: 'Yes, ask me',
  no: 'No, Claude decides',
}

export const COMMITS = {
  question: 'Commit after each verified slice?',
  yes: 'Yes, commit each slice',
  no: 'No, I commit myself',
}

export const DOCS = {
  question:
    'Which documents should stay once the workflow is done? The spec, design, slices and ADRs are kept until the end either way, and removed in the closing.',
  all: 'Keep everything',
  specs: 'Remove the spec and ADRs',
  code: 'Keep only the code',
  ask: 'Choose at the end',
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
  defaultPlan: (plan: string) => `Defaults: ${plan}.`,
  recommendedChanges: (changes: string) => `Claude recommends: ${changes}.`,
  recommendedAreDefaults: "Claude's recommendations are the defaults.",
  defaults: 'Use the defaults',
  recommended: "Use Claude's recommendations",
  perStep: 'Choose per step',
  notAsked: (used: string) => `Technical decisions are off, so the models were not asked: the steps use ${used}.`,
  usedDefaults: 'the defaults',
  usedRecommended: (changes: string) => `Claude's recommendations (${changes})`,
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

export const GATE = {
  continue: 'Continue',
  stop: 'Stop here',
  wait: 'Not yet',
  notAsked: (phase: Phase) => `Technical decisions are off, so the user was not asked at the ${phase} gate: the workflow moved on as if they chose Continue.`,
}
// The options Claude offers in the closing's publish question; each drops the parts already done.
export const PUBLISH = {
  all: 'Commit, push and open the pull request',
  push: 'Commit and push',
  commit: 'Commit only',
  nothing: 'Nothing',
}

export const UNLOCK = { yes: 'Unlock', no: 'Keep locked' }
export const DELETE = {
  question: (slug: string, status: string) =>
    `Delete the workflow "${slug}" (${status})? Its state, test lock and run log are deleted, so /workflow no longer lists it. Committed files and the pushed branch stay.`,
  yes: 'Delete it',
  no: 'Cancel',
  blocked: (worktree: string, reason: string) =>
    `The worktree ${worktree} cannot be removed: ${reason}. Delete the workflow anyway and keep the worktree? Once it is deleted, the mod no longer offers the removal.`,
  anyway: 'Delete it, keep the worktree',
  cancel: 'Cancel',
}
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
  inspect: 'a review of the branch, the fixes the user picks and, for a feature, the closing: the pull request and the documents the user drops',
  retro: 'small changes to the setup, from what this workflow taught, then the closing: the pull request and the documents the user drops',
}

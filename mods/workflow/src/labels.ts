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

export const BRANCH = {
  create: (branch: string) => `Create ${branch}`,
  stay: (branch: string) => `Stay on ${branch}`,
}

export const WORKTREE = {
  create: 'Create a worktree next to this repo',
  here: 'Use this checkout anyway',
}

export const SWITCH = {
  yes: (branch: string) => `Switch to ${branch}`,
  no: 'Cancel',
}

export const GATE = { approve: 'Approve', wait: 'Not yet' }
export const UNLOCK = { yes: 'Unlock', no: 'Keep locked' }
export const RETRO = { run: 'Run the retro first', close: 'Close now' }
export const ADOPT = { rebuild: 'Rebuild it', skip: 'Skip' }

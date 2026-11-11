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

export const GATE = { approve: 'Continue', stop: 'Stop here', wait: 'Not yet' }
export const UNLOCK = { yes: 'Unlock', no: 'Keep locked' }
export const RETRO = { run: 'Run the retro first', close: 'Close now' }
export const ADOPT = { rebuild: 'Rebuild it', skip: 'Skip' }

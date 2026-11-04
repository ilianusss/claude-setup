import type { Register } from 'claude-code'

import { registerScribe } from '../src/scribe'

export const register: Register = on => {
  registerScribe(on)
}

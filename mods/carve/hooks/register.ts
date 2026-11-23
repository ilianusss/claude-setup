import type { Register } from 'claude-code'

import { registerCarve } from '../src/carve'

export const register: Register = on => {
  registerCarve(on)
}

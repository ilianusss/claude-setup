import type { Register } from 'claude-code'

import { registerShush } from '../src/shush'

export const register: Register = on => {
  registerShush(on)
}

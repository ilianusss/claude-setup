import type { Register } from 'claude-code'

import { hookApi } from '../src/engine/api'
import { hookCommand } from '../src/engine/command'
import { hookLifecycle } from '../src/engine/lifecycle'
import { hookChromeRenders } from '../src/engine/render-chrome'
import { hookReplyRenders } from '../src/engine/render-reply'
import { hookToolRenders } from '../src/engine/render-tools'
import { newTurn } from '../src/engine/state'

// The mod's entry (hooks.json). Only src/engine/ touches `$`; everything it draws with is
// pure, under the other folders of src/. See docs/architecture.md.
export const register: Register = on => {
  const turn = newTurn()

  hookApi(on)
  hookLifecycle(on, turn)
  hookCommand(on, turn)
  hookToolRenders(on)
  hookReplyRenders(on, turn)
  hookChromeRenders(on, turn)
}

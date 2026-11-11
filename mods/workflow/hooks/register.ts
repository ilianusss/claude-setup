import type { Register } from 'claude-code'

import { registerAgents } from '../src/agents'
import { registerCommand, registerCommands } from '../src/commands'
import { loadContext } from '../src/context'
import { registerGuards } from '../src/guards'
import { newRuntime } from '../src/runtime'
import { announce, refreshStatus } from '../src/status'
import { registerToolHandlers, registerToolsOnce } from '../src/tools'

export const register: Register = on => {
  const runtime = newRuntime()

  registerCommands(on, runtime)
  registerToolHandlers(on)
  registerGuards(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await registerCommand($)
    const context = await loadContext($)
    if (context === undefined || context.workflows.length === 0) return started
    await registerToolsOnce($, runtime)
    await announce($, context, await $.clock.now())
    await refreshStatus($, context)
    await registerAgents($, context)
    return started
  })
}

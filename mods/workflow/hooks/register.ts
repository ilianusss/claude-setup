import type { Register } from 'claude-code'

import { clearThenSubmit } from '../src/clock'
import { registerCommand, registerCommands } from '../src/commands'
import { loadContext } from '../src/context'
import { registerGuards } from '../src/guards'
import { phasePrompt } from '../src/prompts'
import { newRuntime } from '../src/runtime'
import { announce, refreshStatus } from '../src/status'
import { registerToolHandlers, registerToolsOnce } from '../src/tools'

export const register: Register = on => {
  const runtime = newRuntime()

  registerCommands(on, runtime)
  registerToolHandlers(on, runtime)
  registerGuards(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await registerCommand($)
    const context = await loadContext($)
    if (context === undefined || context.workflows.length === 0) return started
    await registerToolsOnce($, runtime)
    await announce($, context, await $.clock.now())
    await refreshStatus($, context)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    const slug = runtime.pendingNext
    if (slug === undefined || e.agentId !== undefined || e.reason !== 'answer') return completed
    runtime.pendingNext = undefined
    const context = await loadContext($)
    const workflow = context?.workflows.find(candidate => candidate.slug === slug)
    if (context !== undefined && workflow !== undefined) clearThenSubmit($, await phasePrompt($, context, workflow))
    return completed
  })
}

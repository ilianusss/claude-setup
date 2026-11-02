import type { Register } from 'claude-code'

import { integrityState, registerIntegrity, weakeningsAtTurnStart } from '../src/integrity'
import { registerSafety } from '../src/safety'
import { emDashesAtTurnStart, registerTypography, type TypographyState } from '../src/typography'

export const register: Register = on => {
  const typography: TypographyState = { emDashesAtTurnStart: new Map() }
  const integrity = integrityState()
  registerTypography(on, typography)
  registerSafety(on)
  registerIntegrity(on, integrity)

  // A plugin registers turn.start once, so both checks take their snapshot here.
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) await Promise.all([emDashesAtTurnStart($, typography), weakeningsAtTurnStart($, integrity)])
    return started
  })
}

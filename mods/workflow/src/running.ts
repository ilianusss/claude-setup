import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface } from 'claude-code'

import { describe } from './refusal'

// The build agents running in a lane, by agentId, and the lanes reserved for an agent about to start. Kept in $.state,
// which a reload of the mod keeps, so a lane whose agent started before a reload is still merged when its run ends.
const laneAgents = atom({ plugin: 'workflow', key: 'laneAgents' } as const, {}, { shape: 'lane-agents-1' })

export type LaneRef = { slug: string; slice: number }
type LaneAgent = LaneRef & { reservedAt?: number }

const ENDED: readonly AgentStatus[] = ['completed', 'failed', 'killed']
const RESERVED = 'reserved:'
// A spawn confirms its reservation within moments; one older than this was left by a failed hook or a reload.
const RESERVATION_MS = 60_000

function reservationOf(lane: LaneRef): string {
  return `${RESERVED}${lane.slug}:${lane.slice}`
}

function isSameLane(a: LaneRef, b: LaneRef): boolean {
  return a.slug === b.slug && a.slice === b.slice
}

function isFresh(agent: LaneAgent, now: number): boolean {
  return agent.reservedAt !== undefined && now - agent.reservedAt < RESERVATION_MS
}

// An agent whose end never reached the mod would hold its lane for good: the engine's list says which still run, and
// a reservation counts until it is stale. When the list cannot be read, every agent counts as running, so no lane gets
// two agents.
async function forgetEnded($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  let running: Set<string>
  try {
    running = new Set((await $.agent.list()).filter(agent => !ENDED.includes(agent.status)).map(agent => agent.id))
  } catch (error) {
    $.ui.log(`workflow: the running agents could not be listed, so every lane agent counts as running: ${describe(error)}`, { to: 'debug' })
    return
  }
  await update($, laneAgents, agents =>
    Object.fromEntries(Object.entries(agents).filter(([id, agent]) => (id.startsWith(RESERVED) ? isFresh(agent, now) : running.has(id)))),
  )
}

export async function runningSlices($: EngineInterface, slug: string): Promise<number[]> {
  await forgetEnded($)
  return Object.values(await read($, laneAgents))
    .filter(agent => agent.slug === slug)
    .map(agent => agent.slice)
}

// Spawns sent in one message run at the same time: the lane is reserved in one update, so only one of them gets it.
export async function reserveLaneAgent($: EngineInterface, lane: LaneRef): Promise<boolean> {
  await forgetEnded($)
  const reservedAt = await $.clock.now()
  const reservation = { isTaken: false }
  await update($, laneAgents, agents => {
    reservation.isTaken = Object.values(agents).some(agent => isSameLane(agent, lane))
    return reservation.isTaken ? agents : { ...agents, [reservationOf(lane)]: { slug: lane.slug, slice: lane.slice, reservedAt } }
  })
  return !reservation.isTaken
}

export async function confirmLaneAgent($: EngineInterface, lane: LaneRef, agentId: string): Promise<void> {
  await update($, laneAgents, agents => ({
    ...Object.fromEntries(Object.entries(agents).filter(([id]) => id !== reservationOf(lane))),
    [agentId]: { slug: lane.slug, slice: lane.slice },
  }))
}

export async function releaseLaneAgent($: EngineInterface, lane: LaneRef): Promise<void> {
  await update($, laneAgents, agents => Object.fromEntries(Object.entries(agents).filter(([id]) => id !== reservationOf(lane))))
}

export async function takeLaneAgent($: EngineInterface, agentId: string): Promise<LaneRef | undefined> {
  const found = (await read($, laneAgents))[agentId]
  if (found === undefined) return undefined
  await update($, laneAgents, agents => Object.fromEntries(Object.entries(agents).filter(([id]) => id !== agentId)))
  return { slug: found.slug, slice: found.slice }
}

export type WorkflowRecommendation = { step: string; model: string; effort: string; reason?: string }

// The values the model picker draws from. Plan entries and recommendations are kept as written and parsed again by
// src/plan.ts on every read, because they reach $.agent.register.
export type WorkflowPicker = {
  slug: string
  steps: string[]
  plan: string[]
  recommendations: WorkflowRecommendation[]
  then: 'phase' | 'stay'
}

export type WorkflowActivity = 'working' | 'waiting'

// What the band above the prompt and the status line draw, computed from the state file each time the mod changes it.
// A sub-step has a number in the phases the conversation leads, and only a name in build and inspect, which the mod
// names itself.
export type WorkflowBanner = {
  slug: string
  phases: string[]
  phase: string
  slice: { number: number; count: number } | null
  step: { name: string; number?: number; count?: number } | null
  runner: string
}

export type WorkflowVerified = { slug: string; slice: number }

declare module 'claude-code' {
  // The mod's own tools, declared here because the generated MCP types list only the tools of the session that last
  // saved the mod, and a session outside a workflow repo never registers these.
  interface McpToolInputs {
    mcp__workflow__handoff: { stopped: string; next: string; questions?: string[]; paths?: string[]; goal?: string }
    mcp__workflow__advance: { summary: string; recommendations?: WorkflowRecommendation[] }
    mcp__workflow__lock: {}
    mcp__workflow__verify: {}
    mcp__workflow__unlock: { file: string; reason: string }
    mcp__workflow__progress: { step: number }
  }

  interface PluginState {
    workflow: {
      picker: Shaped<WorkflowPicker | null>
      recommendations: Shaped<Record<string, WorkflowRecommendation[]>>
      banner: Shaped<WorkflowBanner | null>
      activity: Shaped<WorkflowActivity>
      verified: Shaped<WorkflowVerified | null>
    }
  }
}

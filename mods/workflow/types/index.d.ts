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

declare module 'claude-code' {
  // The mod's own tools, declared here because the generated MCP types list only the tools of the session that last
  // saved the mod, and a session outside a workflow repo never registers these.
  interface McpToolInputs {
    mcp__workflow__handoff: { stopped: string; next: string; questions?: string[]; paths?: string[]; goal?: string }
    mcp__workflow__advance: { summary: string; recommendations?: WorkflowRecommendation[] }
    mcp__workflow__lock: {}
    mcp__workflow__verify: {}
    mcp__workflow__unlock: { file: string; reason: string }
  }

  interface PluginState {
    workflow: {
      picker: Shaped<WorkflowPicker | null>
      recommendations: Shaped<Record<string, WorkflowRecommendation[]>>
    }
  }
}

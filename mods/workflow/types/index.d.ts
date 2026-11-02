// The mod's own tools, declared here because the generated MCP types list only the tools of the session that last
// saved the mod, and a session outside a workflow repo never registers these.
export {}

declare module 'claude-code' {
  interface McpToolInputs {
    mcp__workflow__handoff: { stopped: string; next: string; questions?: string[]; paths?: string[] }
    mcp__workflow__advance: { summary: string }
    mcp__workflow__lock: {}
    mcp__workflow__verify: {}
    mcp__workflow__unlock: { file: string; reason: string }
  }
}

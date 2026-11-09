export type ShushOff = boolean

declare module 'claude-code' {
  interface PluginState {
    shush: { isOff: ShushOff }
  }
}

export type SafetyOff = boolean

declare module 'claude-code' {
  interface PluginState {
    warden: { isSafetyOff: SafetyOff }
  }
}

export type Runtime = {
  toolsRegistered: boolean
  handovers: Map<string, string>
}

export function newRuntime(): Runtime {
  return { toolsRegistered: false, handovers: new Map() }
}

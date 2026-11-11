export type Runtime = {
  toolsRegistered: boolean
}

export function newRuntime(): Runtime {
  return { toolsRegistered: false }
}

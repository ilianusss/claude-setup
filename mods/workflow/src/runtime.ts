export type Runtime = {
  toolsRegistered: boolean
  handovers: Map<string, string>
  agreedRemoval: string | undefined
}

export function newRuntime(): Runtime {
  return { toolsRegistered: false, handovers: new Map(), agreedRemoval: undefined }
}

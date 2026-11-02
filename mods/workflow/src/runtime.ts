export type Runtime = {
  toolsRegistered: boolean
  pendingNext: string | undefined
}

export function newRuntime(): Runtime {
  return { toolsRegistered: false, pendingNext: undefined }
}

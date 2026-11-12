export type AgreedRemoval = { slug: string; ignored: readonly string[] }

export type Runtime = {
  toolsRegistered: boolean
  agreedRemoval: AgreedRemoval | undefined
}

export function newRuntime(): Runtime {
  return { toolsRegistered: false, agreedRemoval: undefined }
}

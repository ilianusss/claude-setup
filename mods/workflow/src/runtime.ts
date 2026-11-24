// `forget`: the removal was agreed through /workflow delete, so finish deletes the workflow's record after it.
export type AgreedRemoval = { slug: string; ignored: readonly string[]; forget: boolean }

export type Runtime = {
  toolsRegistered: boolean
  agreedRemoval: AgreedRemoval | undefined
}

export function newRuntime(): Runtime {
  return { toolsRegistered: false, agreedRemoval: undefined }
}

export class Refusal extends Error {}

export function refuse(message: string): never {
  throw new Refusal(message)
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

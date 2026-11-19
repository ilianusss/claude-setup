const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

const toHex = (rgb: readonly number[]): string =>
  `#${rgb.map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('')}`

// `amount` of the way from `from` to `to`; `from` as given where either is not `#rrggbb`.
export function mix(from: string, to: string, amount: number): string {
  if (![from, to].every(hex => /^#[0-9a-f]{6}$/i.test(hex))) {
    return from
  }

  const target = channels(to)

  return toHex(channels(from).map((value, i) => value + ((target[i] ?? value) - value) * amount))
}

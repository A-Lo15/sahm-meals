export interface Store {
  id: string
  name: string
  abbreviation: string
  displayOrder: number
}

export function deriveAbbreviation(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 1) {
    const w = words[0]
    return (w[0]?.toUpperCase() ?? '') + (w[1]?.toLowerCase() ?? '')
  }
  return words.slice(0, 3).map(w => w[0]?.toUpperCase() ?? '').join('')
}

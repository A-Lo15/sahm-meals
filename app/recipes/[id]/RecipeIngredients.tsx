'use client'

import { useState } from 'react'
import type { Ingredient } from '@/lib/types'

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

function parseQty(s: string): number {
  if (!s?.trim()) return 0
  let str = s.trim()
  for (const [char, val] of Object.entries(UNICODE_FRACTIONS)) {
    str = str.replace(char, ` ${val}`)
  }
  str = str.trim()
  const mixed = str.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3])
  const frac = str.match(/^(\d+)\/(\d+)$/)
  if (frac) return parseInt(frac[1]) / parseInt(frac[2])
  const n = parseFloat(str)
  return isNaN(n) ? 0 : n
}

function formatQty(n: number): string {
  if (n === 0) return ''
  const fracs: [number, string][] = [
    [0.25, '¼'], [0.5, '½'], [0.75, '¾'],
    [1 / 3, '⅓'], [2 / 3, '⅔'],
    [0.125, '⅛'], [0.375, '⅜'], [0.625, '⅝'], [0.875, '⅞'],
  ]
  const whole = Math.floor(n)
  const frac = n - whole
  for (const [val, char] of fracs) {
    if (Math.abs(frac - val) < 0.02) {
      return whole > 0 ? `${whole} ${char}` : char
    }
  }
  if (Number.isInteger(n)) return String(n)
  return parseFloat(n.toFixed(2)).toString()
}

function scaleIngredient(ing: Ingredient, scale: number): string {
  const qty = parseQty(ing.quantity)
  const scaledQty = qty > 0 ? formatQty(qty * scale) : ing.quantity
  const parts = [scaledQty, ing.unit, ing.name].filter(Boolean).join(' ')
  return ing.notes ? `${parts} (${ing.notes})` : parts
}

interface Props {
  ingredients: Ingredient[]
  defaultServings: number
}

export default function RecipeIngredients({ ingredients, defaultServings }: Props) {
  const [servings, setServings] = useState(defaultServings)
  const scale = servings / defaultServings

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Ingredients
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setServings((s) => Math.max(1, s - 1))}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-lg leading-none active:bg-gray-200"
            aria-label="Decrease servings"
          >
            −
          </button>
          <span className="text-sm text-gray-500 w-16 text-center">
            {servings} serving{servings !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setServings((s) => s + 1)}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-lg leading-none active:bg-gray-200"
            aria-label="Increase servings"
          >
            +
          </button>
        </div>
      </div>
      <ul className="space-y-2">
        {ingredients.map((ing, i) => (
          <li key={i} className="flex items-start gap-2 text-gray-800 text-base">
            <span className="text-gray-300 mt-1 leading-none">•</span>
            <span>{scaleIngredient(ing, scale)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

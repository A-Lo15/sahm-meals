export const CUISINES = ['Italian', 'Mexican', 'American', 'Asian', 'Greek', 'Other'] as const
export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack', 'Appetizer/Side'] as const
export const COOKING_METHODS = ['Oven Baked', 'Stovetop', 'Grill', 'Slow Cooker', 'No-Cook', 'Sheet Pan', 'Other'] as const

export interface RecipeTags {
  cuisines: string[]
  meal_types: string[]
  cooking_methods: string[]
}

export function matchesTagFilter(itemTags: string[], selected: string[]): boolean {
  return selected.length === 0 || itemTags.some((t) => selected.includes(t))
}

import Anthropic from '@anthropic-ai/sdk'
import type { Ingredient } from './types'

export async function suggestRecipeTags(recipe: {
  title: string
  description: string | null
  ingredients: Ingredient[]
  instructions: string | null
}): Promise<RecipeTags> {
  const empty: RecipeTags = { cuisines: [], meal_types: [], cooking_methods: [] }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const ingredientList = recipe.ingredients.map((i) => i.name).join(', ')

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Categorize this recipe. Return ONLY valid JSON — no markdown fences, no explanation.

Pick zero or more values for each field, using ONLY the exact strings listed (case-sensitive) — never invent new values.

cuisines: choose from ${JSON.stringify(CUISINES)}
meal_types: choose from ${JSON.stringify(MEAL_TYPES)}
cooking_methods: choose from ${JSON.stringify(COOKING_METHODS)}

Schema:
{"cuisines": string[], "meal_types": string[], "cooking_methods": string[]}

Recipe title: ${recipe.title}
Description: ${recipe.description ?? ''}
Ingredients: ${ingredientList}
Instructions: ${recipe.instructions ?? ''}`,
        },
      ],
    })

    const block = response.content[0]
    if (block.type !== 'text') return empty

    const jsonMatch = block.text.match(/\{[\s\S]+\}/)
    if (!jsonMatch) return empty
    const parsed = JSON.parse(jsonMatch[0]) as Partial<RecipeTags>

    const cuisinesList: readonly string[] = CUISINES
    const mealTypesList: readonly string[] = MEAL_TYPES
    const cookingMethodsList: readonly string[] = COOKING_METHODS

    return {
      cuisines: (parsed.cuisines ?? []).filter((c) => cuisinesList.includes(c)),
      meal_types: (parsed.meal_types ?? []).filter((m) => mealTypesList.includes(m)),
      cooking_methods: (parsed.cooking_methods ?? []).filter((c) => cookingMethodsList.includes(c)),
    }
  } catch {
    return empty
  }
}

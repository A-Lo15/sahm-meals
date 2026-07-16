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

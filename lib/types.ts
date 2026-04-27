export type RecipeState = 'tried' | 'saved' | 'favorited'

export type IngredientCategory =
  | 'produce'
  | 'dairy'
  | 'meat'
  | 'pantry'
  | 'frozen'
  | 'household'
  | 'other'
  | ''

export interface Ingredient {
  name: string
  quantity: string
  unit: string
  category: IngredientCategory
  notes: string
}

export interface Recipe {
  id: string
  household_id: string
  title: string
  description: string | null
  default_servings: number
  source_url: string | null
  source_image_url: string | null
  ingredients: Ingredient[]
  instructions: string | null
  original_parsed_json: Record<string, unknown> | null
  state: RecipeState
  last_cooked_at: string | null
  times_cooked: number
  created_at: string
  updated_at: string
}

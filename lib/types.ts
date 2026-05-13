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

export interface CustomMealInput {
  title: string
  servings: number
  ingredients: Ingredient[]
  saveToLibrary: boolean
}

export interface MealPlan {
  id: string
  household_id: string
  week_start_date: string
  created_at: string
}

export interface SlotWithRecipe {
  id: string
  meal_plan_id: string
  recipe_id: string
  day_of_week: number
  servings_override: number | null
  position: number
  recipe: {
    id: string
    title: string
    default_servings: number
    source_image_url: string | null
    state: RecipeState
    in_library: boolean
  }
}

export interface RecipeOption {
  id: string
  title: string
  default_servings: number
  source_image_url: string | null
  state: RecipeState
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
  in_library: boolean
  last_cooked_at: string | null
  times_cooked: number
  created_at: string
  updated_at: string
}

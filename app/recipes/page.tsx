import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Recipe } from '@/lib/types'

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  tried: { label: 'Tried', cls: 'bg-gray-100 text-gray-600' },
  saved: { label: 'Saved', cls: 'bg-blue-100 text-blue-700' },
  favorited: { label: '★ Fave', cls: 'bg-amber-100 text-amber-700' },
}

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createAdminClient()

  const { data: userData } = await db
    .from('users')
    .select('household_id')
    .eq('id', user.id)
    .single()

  const householdId = userData?.household_id as string | undefined
  const tab = (searchParams.tab as string) ?? 'library'

  let recipes: Recipe[] = []

  if (householdId) {
    if (tab === 'history') {
      const { data } = await db
        .from('recipes')
        .select('*')
        .eq('household_id', householdId)
        .eq('in_library', true)
        .order('updated_at', { ascending: false })
      recipes = (data as Recipe[]) ?? []
    } else {
      const { data } = await db
        .from('recipes')
        .select('*')
        .eq('household_id', householdId)
        .eq('in_library', true)
        .in('state', ['saved', 'favorited'])
        .order('updated_at', { ascending: false })
      recipes = (data as Recipe[]) ?? []
    }
  }

  const tabs = [
    { id: 'library', label: 'Library' },
    { id: 'history', label: 'History' },
  ]

  const emptyIcon = tab === 'history' ? '📜' : '📚'
  const emptyMessage = tab === 'history' ? 'No recipes yet' : 'Your library is empty'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <Link href="/" className="text-gray-500 py-1 pr-3">
            ‹ Home
          </Link>
          <Link
            href="/recipes/new"
            className="w-10 h-10 flex items-center justify-center bg-green-600 text-white rounded-full text-2xl leading-none"
            aria-label="Add recipe"
          >
            +
          </Link>
        </div>
      </header>

      <div className="bg-white border-b border-gray-200 sticky top-[65px] z-10">
        <div className="max-w-lg mx-auto flex">
          {tabs.map((t) => (
            <Link
              key={t.id}
              href={`/recipes?tab=${t.id}`}
              replace
              className={`flex-1 py-3 text-sm font-medium text-center border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {recipes.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">{emptyIcon}</div>
            <p className="font-medium text-gray-600">{emptyMessage}</p>
            <Link
              href="/recipes/new"
              className="mt-4 inline-block px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium"
            >
              Add a recipe
            </Link>
          </div>
        ) : (
          recipes.map((recipe) => {
            const badge = STATE_BADGE[recipe.state] ?? STATE_BADGE.tried
            return (
              <Link key={recipe.id} href={`/recipes/${recipe.id}`} className="block">
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 active:bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 text-base truncate">
                        {recipe.title}
                      </h3>
                      {recipe.description && (
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">
                          {recipe.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {recipe.default_servings} servings
                        </span>
                        {recipe.times_cooked > 0 && (
                          <span className="text-xs text-gray-400">
                            {recipe.times_cooked}× cooked
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })
        )}
      </main>
    </div>
  )
}

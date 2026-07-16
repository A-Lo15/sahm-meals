import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RecipesListClient from './RecipesListClient'
import type { Recipe } from '@/lib/types'

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

      <RecipesListClient recipes={recipes} emptyIcon={emptyIcon} emptyMessage={emptyMessage} />
    </div>
  )
}

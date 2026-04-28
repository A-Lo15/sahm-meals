import { createClient } from '@/lib/supabase/server'
import { parseRecipeUrl } from '@/lib/parseRecipe'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let url: string
  try {
    const body = await request.json()
    url = body.url?.trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 })

  try {
    const result = await parseRecipeUrl(url)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse recipe' },
      { status: 422 }
    )
  }
}

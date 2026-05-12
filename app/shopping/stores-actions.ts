'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { type Store, deriveAbbreviation } from '@/lib/stores'

async function getContext() {
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
  if (!householdId) throw new Error('No household found')
  return { db, householdId }
}

export async function getStores(): Promise<Store[]> {
  const { db, householdId } = await getContext()
  const { data } = await db
    .from('stores')
    .select('id, name, abbreviation, display_order')
    .eq('household_id', householdId)
    .order('display_order', { ascending: true })
  return (data ?? []).map(row => ({
    id: row.id as string,
    name: row.name as string,
    abbreviation: row.abbreviation as string,
    displayOrder: row.display_order as number,
  }))
}

export async function createStore(name: string): Promise<Store> {
  const { db, householdId } = await getContext()
  const abbreviation = deriveAbbreviation(name)

  // Place new store after the last existing one
  const { data: last } = await db
    .from('stores')
    .select('display_order')
    .eq('household_id', householdId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const displayOrder = (last?.display_order ?? -1) + 1

  const { data, error } = await db
    .from('stores')
    .insert({ household_id: householdId, name, abbreviation, display_order: displayOrder })
    .select('id, name, abbreviation, display_order')
    .single()
  if (error) throw error

  return {
    id: data.id as string,
    name: data.name as string,
    abbreviation: data.abbreviation as string,
    displayOrder: data.display_order as number,
  }
}

export async function deleteStore(id: string): Promise<void> {
  const { db, householdId } = await getContext()
  const { error } = await db
    .from('stores')
    .delete()
    .eq('id', id)
    .eq('household_id', householdId)
  if (error) throw error
}

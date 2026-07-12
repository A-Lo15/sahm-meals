import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMealPlans } from './actions'
import PlannerClient from './PlannerClient'

export default async function PlannerPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const plans = await getMealPlans()

  return <PlannerClient initialPlans={plans} />
}

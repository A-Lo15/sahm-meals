'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createMealPlan } from './actions'

interface Plan {
  id: string
  start_date: string
  end_date: string
  meal_count: number
}

interface Props {
  initialPlans: Plan[]
}

function formatRange(startDate: string, endDate: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const start = new Date(startDate + 'T12:00:00')
  const end = new Date(endDate + 'T12:00:00')
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
}

export default function PlannerClient({ initialPlans }: Props) {
  const router = useRouter()
  const [plans, setPlans] = useState<Plan[]>(initialPlans)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const today = new Date().toISOString().split('T')[0]

  function openSheet() {
    setStartDate('')
    setEndDate('')
    setCreateError(null)
    setSheetOpen(true)
  }

  function handleCreate() {
    if (!startDate || !endDate) {
      setCreateError('Please select both a start and end date.')
      return
    }
    if (endDate < startDate) {
      setCreateError('End date must be on or after the start date.')
      return
    }
    setCreateError(null)
    startTransition(async () => {
      try {
        const { id } = await createMealPlan(startDate, endDate)
        router.push(`/planner/${id}`)
      } catch {
        setCreateError('Failed to create plan. Please try again.')
      }
    })
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Link href="/" className="text-sm text-gray-500 py-1 pr-3">Home</Link>
          <h1 className="font-bold text-gray-900 text-base">Meal Plans</h1>
          <button
            onClick={openSheet}
            className="text-sm font-semibold text-green-600"
          >
            + New
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {plans.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm mb-4">No plans yet.</p>
            <button
              onClick={openSheet}
              className="px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl"
            >
              Create your first plan
            </button>
          </div>
        ) : (
          plans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => router.push(`/planner/${plan.id}`)}
              className="w-full bg-white rounded-2xl border border-gray-200 px-4 py-4 text-left active:bg-gray-50"
            >
              <p className="font-semibold text-gray-900">{formatRange(plan.start_date, plan.end_date)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {plan.meal_count} meal{plan.meal_count !== 1 ? 's' : ''} planned
              </p>
            </button>
          ))
        )}
      </div>

      {/* New Plan bottom sheet */}
      {sheetOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setSheetOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl px-4 pb-10 pt-4">
            <div className="flex flex-col items-center mb-4">
              <div className="w-10 h-1 bg-gray-300 rounded-full mb-3" />
              <div className="flex items-center justify-between w-full">
                <h2 className="font-semibold text-gray-900 text-base">New Plan</h2>
                <button onClick={() => setSheetOpen(false)} className="text-gray-400 text-sm">Cancel</button>
              </div>
            </div>

            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Start date
            </label>
            <input
              type="date"
              value={startDate}
              min={today}
              onChange={(e) => {
                setStartDate(e.target.value)
                if (endDate && e.target.value > endDate) setEndDate(e.target.value)
              }}
              className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-none mb-4"
            />

            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              End date
            </label>
            <input
              type="date"
              value={endDate}
              min={startDate || today}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-none mb-4"
            />

            {createError && (
              <p className="text-sm text-red-500 mb-3">{createError}</p>
            )}

            <button
              onClick={handleCreate}
              disabled={!startDate || !endDate}
              className="w-full py-3 bg-green-600 text-white font-semibold rounded-xl text-sm disabled:opacity-40 active:bg-green-700"
            >
              Create Plan
            </button>
          </div>
        </>
      )}
    </div>
  )
}

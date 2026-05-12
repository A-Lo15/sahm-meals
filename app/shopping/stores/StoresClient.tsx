'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createStore, deleteStore } from '../stores-actions'
import type { Store } from '@/lib/stores'

interface Props {
  initialStores: Store[]
}

export default function StoresClient({ initialStores }: Props) {
  const router = useRouter()
  const [stores, setStores] = useState<Store[]>(initialStores)
  const [newName, setNewName] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  async function handleDelete(id: string) {
    setStores(prev => prev.filter(s => s.id !== id))
    await deleteStore(id)
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    setIsAdding(true)
    try {
      const store = await createStore(name)
      setStores(prev => [...prev, store])
      setNewName('')
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-sm text-gray-500 py-1 pr-3"
          >
            ← Back
          </button>
          <h1 className="font-bold text-gray-900 text-base flex-1 text-center">My Stores</h1>
          <div className="w-14" />
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Store list */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Your stores
          </p>
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
            {stores.map((store) => (
              <div key={store.id} className="flex items-center gap-3 px-4 py-3.5">
                <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-md flex-shrink-0 min-w-[2rem] text-center">
                  {store.abbreviation}
                </span>
                <span className="flex-1 text-sm text-gray-800">{store.name}</span>
                {stores.length > 1 && (
                  <button
                    onClick={() => handleDelete(store.id)}
                    className="text-gray-300 text-lg leading-none px-1 active:text-red-400"
                    aria-label={`Delete ${store.name}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Add store */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Add a store
          </p>
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                placeholder="Store name…"
                className="flex-1 bg-transparent text-sm focus:outline-none text-gray-800 placeholder-gray-400"
              />
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || isAdding}
                className="text-sm font-semibold text-green-600 disabled:opacity-40 active:text-green-700"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center px-4">
          Items routed to a deleted store will be re-routed by category on next list build.
        </p>
      </div>
    </div>
  )
}

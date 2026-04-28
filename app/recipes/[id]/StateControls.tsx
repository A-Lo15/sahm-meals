'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateRecipeState, deleteRecipe, resetRecipeToOriginal } from '../actions'
import type { RecipeState } from '@/lib/types'

interface Props {
  recipeId: string
  initialState: RecipeState
  hasOriginal: boolean
}

export default function StateControls({ recipeId, initialState, hasOriginal }: Props) {
  const router = useRouter()
  const [state, setState] = useState<RecipeState>(initialState)
  const [showMenu, setShowMenu] = useState(false)
  const [isPending, startTransition] = useTransition()

  function transition(newState: RecipeState) {
    setState(newState)
    setShowMenu(false)
    startTransition(() => updateRecipeState(recipeId, newState))
  }

  function heartClick() {
    transition(state === 'tried' ? 'saved' : 'tried')
  }

  function starClick() {
    if (state === 'tried') return
    transition(state === 'favorited' ? 'saved' : 'favorited')
  }

  function handleDelete() {
    if (!confirm('Delete this recipe? This cannot be undone.')) return
    setShowMenu(false)
    startTransition(async () => {
      await deleteRecipe(recipeId)
      router.push('/recipes')
    })
  }

  function handleReset() {
    if (!confirm('Reset to the originally imported version? Your edits will be lost.')) return
    setShowMenu(false)
    startTransition(async () => {
      await resetRecipeToOriginal(recipeId)
      router.refresh()
    })
  }

  const inLibrary = state === 'saved' || state === 'favorited'
  const isFav = state === 'favorited'

  return (
    <div className="relative bg-white border-b border-gray-100">
      <div className="flex items-center gap-2 px-4 py-3 max-w-lg mx-auto">
        <button
          onClick={heartClick}
          disabled={isPending}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            inLibrary ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
          }`}
        >
          <span>{inLibrary ? '♥' : '♡'}</span>
          <span>{inLibrary ? 'Saved' : 'Save'}</span>
        </button>

        <button
          onClick={starClick}
          disabled={isPending || state === 'tried'}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-40 ${
            isFav ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-500'
          }`}
        >
          <span>{isFav ? '★' : '☆'}</span>
          <span>Fave</span>
        </button>

        <button
          onClick={() => setShowMenu((v) => !v)}
          className="ml-auto w-10 h-10 flex items-center justify-center text-gray-400 text-lg rounded-full"
          aria-label="More options"
        >
          •••
        </button>
      </div>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
          <div className="absolute right-4 top-full mt-1 bg-white rounded-2xl shadow-xl border border-gray-200 z-30 w-56 overflow-hidden">
            {inLibrary ? (
              <button
                onClick={() => transition('tried')}
                className="w-full text-left px-4 py-3.5 text-sm text-gray-700 border-b border-gray-100 active:bg-gray-50"
              >
                Remove from Library
              </button>
            ) : (
              <button
                onClick={() => transition('saved')}
                className="w-full text-left px-4 py-3.5 text-sm text-gray-700 border-b border-gray-100 active:bg-gray-50"
              >
                Save to Library
              </button>
            )}

            {state === 'saved' && (
              <button
                onClick={() => transition('favorited')}
                className="w-full text-left px-4 py-3.5 text-sm text-gray-700 border-b border-gray-100 active:bg-gray-50"
              >
                Mark as Favorite
              </button>
            )}
            {state === 'favorited' && (
              <button
                onClick={() => transition('saved')}
                className="w-full text-left px-4 py-3.5 text-sm text-gray-700 border-b border-gray-100 active:bg-gray-50"
              >
                Unfavorite
              </button>
            )}

            {hasOriginal && (
              <button
                onClick={handleReset}
                className="w-full text-left px-4 py-3.5 text-sm text-gray-700 border-b border-gray-100 active:bg-gray-50"
              >
                Reset to Original
              </button>
            )}

            <button
              onClick={handleDelete}
              className="w-full text-left px-4 py-3.5 text-sm text-red-600 active:bg-gray-50"
            >
              Delete Recipe
            </button>
          </div>
        </>
      )}
    </div>
  )
}

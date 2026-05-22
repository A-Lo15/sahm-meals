'use client'

interface Props {
  recipeName: string
  onSelectScope: (scope: 'week' | 'library') => void
  onClose: () => void
}

export default function RecipeScopeSheet({ recipeName, onSelectScope, onClose }: Props) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl">
        <div className="flex flex-col items-center pt-3 pb-2 px-4">
          <div className="w-10 h-1 bg-gray-300 rounded-full mb-3" />
          <div className="flex items-center justify-between w-full">
            <h2 className="font-semibold text-gray-900 text-base truncate">
              Edit {recipeName}
            </h2>
            <button onClick={onClose} className="text-gray-400 text-sm ml-3 flex-shrink-0">
              Cancel
            </button>
          </div>
        </div>
        <div className="px-4 pb-10 space-y-3">
          <button
            onClick={() => onSelectScope('week')}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 active:bg-gray-100"
          >
            <p className="text-sm font-semibold text-gray-900">Edit this week&apos;s copy</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Only changes this week. Your library recipe stays as-is.
            </p>
          </button>
          <button
            onClick={() => onSelectScope('library')}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 active:bg-gray-100"
          >
            <p className="text-sm font-semibold text-gray-900">Update library recipe</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Updates the saved recipe everywhere it&apos;s used.
            </p>
          </button>
        </div>
      </div>
    </>
  )
}

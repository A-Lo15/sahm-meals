'use client'

import { useState } from 'react'
import { CUISINES, MEAL_TYPES, COOKING_METHODS } from '@/lib/recipeTags'
import TagPill from './TagPill'

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function PillRow({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: readonly string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <TagPill
            key={opt}
            label={opt}
            selected={selected.includes(opt)}
            onClick={() => onChange(toggleValue(selected, opt))}
          />
        ))}
      </div>
    </div>
  )
}

interface Props {
  selectedCuisines: string[]
  onCuisinesChange: (next: string[]) => void
  selectedMealTypes: string[]
  onMealTypesChange: (next: string[]) => void
  selectedCookingMethods: string[]
  onCookingMethodsChange: (next: string[]) => void
  collapsible?: boolean
}

export default function RecipeTagFilters({
  selectedCuisines,
  onCuisinesChange,
  selectedMealTypes,
  onMealTypesChange,
  selectedCookingMethods,
  onCookingMethodsChange,
  collapsible = false,
}: Props) {
  const [expanded, setExpanded] = useState(!collapsible)
  const activeCount = selectedCuisines.length + selectedMealTypes.length + selectedCookingMethods.length

  return (
    <div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-sm font-medium text-gray-500 px-1 pb-2"
        >
          Filters{activeCount > 0 ? ` (${activeCount})` : ''} {expanded ? '▲' : '▼'}
        </button>
      )}
      {expanded && (
        <div className="space-y-3 pb-3">
          <PillRow label="Cuisine" options={CUISINES} selected={selectedCuisines} onChange={onCuisinesChange} />
          <PillRow label="Meal Type" options={MEAL_TYPES} selected={selectedMealTypes} onChange={onMealTypesChange} />
          <PillRow
            label="Cooking Method"
            options={COOKING_METHODS}
            selected={selectedCookingMethods}
            onChange={onCookingMethodsChange}
          />
        </div>
      )}
    </div>
  )
}

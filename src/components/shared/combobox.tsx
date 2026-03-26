'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ComboboxOption {
  value: string
  label: string
  sublabel?: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onSelect: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
}

export function Combobox({
  options,
  value,
  onSelect,
  placeholder = 'Selecione...',
  searchPlaceholder = 'Buscar...',
  emptyMessage = 'Nenhum resultado.',
  disabled = false,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    (o.sublabel ?? '').toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  function handleSelect(option: ComboboxOption) {
    onSelect(option.value)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          !selected && 'text-muted-foreground'
        )}
      >
        <span className="truncate">
          {selected ? (
            <span>
              {selected.label}
              {selected.sublabel && (
                <span className="text-muted-foreground ml-1">— {selected.sublabel}</span>
              )}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground ml-2" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-md">
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex h-9 w-full bg-transparent py-2 pl-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="py-4 text-center text-sm text-muted-foreground">{emptyMessage}</li>
            ) : (
              filtered.map((option) => (
                <li
                  key={option.value}
                  onClick={() => handleSelect(option)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
                    value === option.value && 'bg-accent'
                  )}
                >
                  <Check className={cn('h-4 w-4 shrink-0', value === option.value ? 'opacity-100' : 'opacity-0')} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{option.label}</p>
                    {option.sublabel && (
                      <p className="truncate text-xs text-muted-foreground">{option.sublabel}</p>
                    )}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

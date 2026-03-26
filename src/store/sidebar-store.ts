import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarState {
  isOpen: boolean
  isCollapsed: boolean
  setOpen: (open: boolean) => void
  toggleCollapsed: () => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isOpen: false,
      isCollapsed: false,
      setOpen: (open) => set({ isOpen: open }),
      toggleCollapsed: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
    }),
    {
      name: 'sidebar-store',
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
    }
  )
)

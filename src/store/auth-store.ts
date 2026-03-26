import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppUser } from '@/types'

interface AuthState {
  user: AppUser | null
  loading: boolean
  setUser: (user: AppUser | null) => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      loading: true,
      setUser: (user) => set({ user }),
      setLoading: (loading) => set({ loading }),
    }),
    {
      name: 'auth-store',
      partialize: (state) => ({ user: state.user }),
    }
  )
)

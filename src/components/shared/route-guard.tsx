'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth-store'
import { Loader2 } from 'lucide-react'

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [user, loading, router])

  // Se o Firebase ainda está verificando (loading) mas já há um usuário em cache
  // (gravado pelo persist do Zustand), mostra o conteúdo imediatamente — sem spinner.
  // Se o Firebase voltar sem sessão válida, o useEffect acima redireciona para o login.
  if (loading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user) return null

  return <>{children}</>
}

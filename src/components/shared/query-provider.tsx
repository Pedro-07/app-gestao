'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,   // dados válidos por 5 min — evita refetch em navegação
            gcTime: 15 * 60 * 1000,     // mantém em memória 15 min após desmontar
            refetchOnWindowFocus: false, // não refaz ao alt+tab de volta
            retry: 1,
          },
        },
      })
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

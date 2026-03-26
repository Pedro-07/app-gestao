import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Configuracoes } from '@/types'

async function fetchAppConfig(): Promise<Configuracoes | null> {
  const snap = await getDoc(doc(db, 'config', 'geral'))
  return snap.exists() ? (snap.data() as Configuracoes) : null
}

export function useAppConfig() {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: fetchAppConfig,
    staleTime: 5 * 60 * 1000, // 5 min cache
  })

  return {
    nomeApp: data?.nomeApp || 'Minha Loja',
    logoUrl: data?.logoUrl || null,
  }
}

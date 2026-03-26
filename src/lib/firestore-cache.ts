/**
 * fetchCacheFirst — lê de IndexedDB local antes de ir à rede.
 *
 * Uso: substitui getDocs() nas queryFn do React Query.
 *
 *   Fase 1: getDocsFromCache → resposta < 100 ms, sem rede.
 *   Fase 2: getDocs normal   → atualiza cache em background (via onNetworkUpdate).
 *
 * Se não houver cache local (primeira visita), cai direto para a rede.
 */

import {
  getDocs, getDocsFromCache,
  type Query, type DocumentData,
} from 'firebase/firestore'

export async function fetchCacheFirst<T>(
  q: Query<DocumentData>,
  transform: (id: string, data: DocumentData) => T,
  onNetworkUpdate?: (fresh: T[]) => void,
): Promise<T[]> {
  // Tenta IndexedDB primeiro
  try {
    const cached = await getDocsFromCache(q)
    if (!cached.empty) {
      const data = cached.docs.map(d => transform(d.id, d.data()))

      // Background: atualiza da rede sem bloquear o retorno
      if (onNetworkUpdate) {
        getDocs(q)
          .then(snap => onNetworkUpdate(snap.docs.map(d => transform(d.id, d.data()))))
          .catch(() => {})
      }

      return data
    }
  } catch {
    // Cache vazio — normal na primeira visita
  }

  // Sem cache: busca da rede normalmente
  const snap = await getDocs(q)
  return snap.docs.map(d => transform(d.id, d.data()))
}

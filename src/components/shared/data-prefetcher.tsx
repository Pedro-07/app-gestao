'use client'

/**
 * DataPrefetcher — sem UI, só carrega dados.
 *
 * Estratégia cache-first em duas fases:
 *   Fase 1 — IndexedDB local (getDocsFromCache): < 100 ms, não depende de rede.
 *             Popula o React Query imediatamente → páginas renderizam sem skeleton.
 *   Fase 2 — Rede (getDocs): roda em background e atualiza o cache com dados frescos.
 *             O usuário não espera; a UI atualiza silenciosamente quando chega.
 *
 * Problema resolvido: getDocs() sempre vai à rede quando online, mesmo com
 * persistentLocalCache configurado (o cache local do Firebase serve apenas offline).
 * getDocsFromCache() lê do IndexedDB diretamente, independente da conexão.
 */

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  collection, getDocs, getDocsFromCache, getDoc, getDocFromCache,
  orderBy, query as fsQuery, doc,
  type Query, type DocumentData,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/auth-store'
import type { Cliente, Produto, Parcela, Venda, Fornecedor, Configuracoes } from '@/types'

export function DataPrefetcher() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const prefetchedRef = useRef(false)

  useEffect(() => {
    if (!user || prefetchedRef.current) return
    prefetchedRef.current = true

    // Converte snapshot para array tipada
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toList = <T,>(docs: any[]) => docs.map(d => ({ id: d.id, ...d.data() } as T))

    // Fase 1 + 2 para uma coleção
    async function load<T>(key: string[], q: Query<DocumentData>) {
      // Fase 1: IndexedDB — imediato
      try {
        const cached = await getDocsFromCache(q)
        if (!cached.empty) qc.setQueryData(key, toList<T>(cached.docs))
      } catch {
        // Cache vazio na primeira visita — normal
      }
      // Fase 2: Rede — background, não bloqueia
      getDocs(q)
        .then(snap => qc.setQueryData(key, toList<T>(snap.docs)))
        .catch(err => console.warn(`[DataPrefetcher] network error ${key[0]}:`, err))
    }

    // Carrega todas as coleções em paralelo
    load<Cliente>(['clientes'], fsQuery(collection(db, 'clientes'), orderBy('nome')))
    load<Produto>(['produtos'], fsQuery(collection(db, 'produtos'), orderBy('codigo')))
    load<Parcela>(['parcelas'], collection(db, 'parcelas') as Query<DocumentData>)
    load<Venda>(['vendas'], fsQuery(collection(db, 'vendas'), orderBy('createdAt', 'desc')))
    load<Fornecedor>(['fornecedores'], collection(db, 'fornecedores') as Query<DocumentData>)

    // Config (documento único — mesma estratégia cache-first)
    const configRef = doc(db, 'config', 'geral')
    getDocFromCache(configRef)
      .then(snap => { if (snap.exists()) qc.setQueryData(['config'], snap.data() as Configuracoes) })
      .catch(() => {})
    getDoc(configRef)
      .then(snap => qc.setQueryData(['config'], snap.exists() ? snap.data() as Configuracoes : null))
      .catch(err => console.warn('[DataPrefetcher] network error config:', err))

  }, [user, qc])

  return null
}

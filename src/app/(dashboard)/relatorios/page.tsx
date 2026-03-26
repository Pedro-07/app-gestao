'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Venda, Parcela, Produto } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, isWithinInterval, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Download, TrendingUp, Users, Package, BarChart3 } from 'lucide-react'
// xlsx é importado dinamicamente apenas ao exportar (evita ~1MB no bundle inicial)

function getDate(ts: Timestamp | Date | string): Date {
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  return new Date(ts)
}

async function fetchRelatoriosData() {
  const [vendasSnap, parcelasSnap, produtosSnap] = await Promise.all([
    getDocs(collection(db, 'vendas')),
    getDocs(collection(db, 'parcelas')),
    getDocs(collection(db, 'produtos')),
  ])
  return {
    vendas: vendasSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Venda)),
    parcelas: parcelasSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Parcela)),
    produtos: produtosSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Produto)),
  }
}

type Periodo = 'mes_atual' | 'mes_passado' | 'semana' | 'ano'

function getPeriodoInterval(periodo: Periodo) {
  const now = new Date()
  switch (periodo) {
    case 'mes_atual':
      return { start: startOfMonth(now), end: endOfMonth(now) }
    case 'mes_passado': {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) }
    }
    case 'semana':
      return { start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }) }
    case 'ano':
      return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31) }
  }
}

export default function RelatoriosPage() {
  const [periodo, setPeriodo] = useState<Periodo>('mes_atual')
  const { data, isLoading } = useQuery({ queryKey: ['relatorios'], queryFn: fetchRelatoriosData })

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>
  }

  const { vendas = [], parcelas = [], produtos = [] } = data ?? {}
  const interval = getPeriodoInterval(periodo)

  const vendasPeriodo = vendas.filter((v) =>
    isWithinInterval(getDate(v.createdAt), interval)
  )

  const totalVendasPeriodo = vendasPeriodo.reduce((acc, v) => acc + v.total, 0)

  // Recebido no período (por data de pagamento)
  const totalRecebidoPeriodo = parcelas.reduce((acc, p) => {
    const pagsPeriodo = (p.pagamentos ?? []).filter((pg) =>
      isWithinInterval(getDate(pg.dataPagamento), interval)
    )
    return acc + pagsPeriodo.reduce((s, pg) => s + pg.valor, 0)
  }, 0)

  // Ranking clientes
  const clienteMap: Record<string, { nome: string; total: number; vendas: number }> = {}
  vendasPeriodo.forEach((v) => {
    if (!clienteMap[v.clienteId]) clienteMap[v.clienteId] = { nome: v.clienteNome, total: 0, vendas: 0 }
    clienteMap[v.clienteId].total += v.total
    clienteMap[v.clienteId].vendas++
  })
  const rankingClientes = Object.values(clienteMap).sort((a, b) => b.total - a.total).slice(0, 10)

  // Produtos mais vendidos
  const produtoMap: Record<string, { nome: string; quantidade: number; receita: number }> = {}
  vendasPeriodo.forEach((v) => {
    v.itens.forEach((item) => {
      if (!produtoMap[item.produtoId]) produtoMap[item.produtoId] = { nome: item.produtoNome, quantidade: 0, receita: 0 }
      produtoMap[item.produtoId].quantidade += item.quantidade
      produtoMap[item.produtoId].receita += item.subtotal
    })
  })
  const rankingProdutos = Object.values(produtoMap).sort((a, b) => b.quantidade - a.quantidade).slice(0, 10)

  // Fluxo mensal (últimos 6 meses)
  const fluxoMensal = Array.from({ length: 6 }, (_, i) => {
    const date = new Date()
    date.setMonth(date.getMonth() - (5 - i))
    const start = startOfMonth(date)
    const end = endOfMonth(date)
    const entradas = parcelas.reduce((acc, p) => {
      const pags = (p.pagamentos ?? []).filter((pg) => isWithinInterval(getDate(pg.dataPagamento), { start, end }))
      return acc + pags.reduce((s, pg) => s + pg.valor, 0)
    }, 0)
    const vendas_ = vendas.filter((v) => isWithinInterval(getDate(v.createdAt), { start, end }))
      .reduce((acc, v) => acc + v.total, 0)
    return { mes: format(date, 'MMM/yy', { locale: ptBR }), entradas, vendas: vendas_ }
  })

  async function exportarExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    const vendasData = vendasPeriodo.map((v) => ({
      'Data': formatDate(getDate(v.createdAt)),
      'Cliente': v.clienteNome,
      'Cidade': v.clienteCidade,
      'Total (R$)': v.total,
      'Forma Pgto': v.formaPagamento,
      'Status': v.status,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vendasData), 'Vendas')

    const clientesData = rankingClientes.map((c, i) => ({
      '#': i + 1,
      'Cliente': c.nome,
      'Qtd Vendas': c.vendas,
      'Total (R$)': c.total,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clientesData), 'Ranking Clientes')

    const produtosData = rankingProdutos.map((p, i) => ({
      '#': i + 1,
      'Produto': p.nome,
      'Qtd Vendida': p.quantidade,
      'Receita (R$)': p.receita,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(produtosData), 'Produtos')

    XLSX.writeFile(wb, `relatorio_${periodo}_${new Date().toISOString().split('T')[0]}.xlsx`)
    const { toast } = await import('sonner')
    toast.success('Arquivo Excel gerado!')
  }

  return (
    <div className="space-y-4">
      {/* Filtro Período */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Select value={periodo} onValueChange={(v: string) => setPeriodo(v as Periodo)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mes_atual">Mês Atual</SelectItem>
            <SelectItem value="mes_passado">Mês Passado</SelectItem>
            <SelectItem value="semana">Esta Semana</SelectItem>
            <SelectItem value="ano">Este Ano</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportarExcel}>
          <Download className="mr-2 h-4 w-4" />
          Exportar Excel
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Vendas no Período</p>
            <p className="text-2xl font-bold">{vendasPeriodo.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Faturado</p>
            <p className="text-xl font-bold text-blue-600">{formatCurrency(totalVendasPeriodo)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Recebido</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(totalRecebidoPeriodo)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Ticket Médio</p>
            <p className="text-xl font-bold">{formatCurrency(vendasPeriodo.length > 0 ? totalVendasPeriodo / vendasPeriodo.length : 0)}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="fluxo">
        <TabsList>
          <TabsTrigger value="fluxo"><BarChart3 className="h-4 w-4 mr-1" />Fluxo Mensal</TabsTrigger>
          <TabsTrigger value="clientes"><Users className="h-4 w-4 mr-1" />Clientes</TabsTrigger>
          <TabsTrigger value="produtos"><Package className="h-4 w-4 mr-1" />Produtos</TabsTrigger>
        </TabsList>

        <TabsContent value="fluxo" className="mt-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Fluxo dos Últimos 6 Meses</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {fluxoMensal.map((m) => (
                  <div key={m.mes} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="capitalize font-medium">{m.mes}</span>
                      <span className="text-muted-foreground">
                        Vendido: {formatCurrency(m.vendas)} · Recebido: {formatCurrency(m.entradas)}
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.min((m.entradas / (m.vendas || 1)) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clientes" className="mt-3">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Ranking de Clientes</CardTitle></CardHeader>
            <CardContent>
              {rankingClientes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sem dados no período</p>
              ) : (
                <div className="space-y-2">
                  {rankingClientes.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-6">#{i + 1}</span>
                        <div>
                          <p className="font-medium">{c.nome}</p>
                          <p className="text-xs text-muted-foreground">{c.vendas} compra(s)</p>
                        </div>
                      </div>
                      <p className="font-bold">{formatCurrency(c.total)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="produtos" className="mt-3">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" />Produtos Mais Vendidos</CardTitle></CardHeader>
            <CardContent>
              {rankingProdutos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sem dados no período</p>
              ) : (
                <div className="space-y-2">
                  {rankingProdutos.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-6">#{i + 1}</span>
                        <div>
                          <p className="font-medium">{p.nome}</p>
                          <p className="text-xs text-muted-foreground">{p.quantidade} peça(s) vendida(s)</p>
                        </div>
                      </div>
                      <p className="font-bold">{formatCurrency(p.receita)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

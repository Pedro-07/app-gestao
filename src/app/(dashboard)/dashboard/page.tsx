'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { formatCurrency, formatDate, isOverdue, isDueInDays } from '@/lib/utils'
import type { Cliente, Parcela, Produto, Venda } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Clock,
  Package,
  ShoppingCart,
  Users,
  ChevronRight,
} from 'lucide-react'

// ─── Fetchers ─────────────────────────────────────────────────────────────────
async function fetchDashboardData() {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const in7Days = new Date()
  in7Days.setDate(in7Days.getDate() + 7)

  const [parcelasSnap, clientesSnap, produtosSnap, vendasSnap] = await Promise.all([
    getDocs(collection(db, 'parcelas')),
    getDocs(query(collection(db, 'clientes'), where('status', '==', 'inadimplente'))),
    getDocs(collection(db, 'produtos')),
    getDocs(query(collection(db, 'vendas'), orderBy('createdAt', 'desc'), limit(5))),
  ])

  const parcelas = parcelasSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Parcela))
  const clientesInadimplentes = clientesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente))
  const produtos = produtosSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Produto))
  const ultimasVendas = vendasSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Venda))

  const pendentes = parcelas.filter((p) => p.status !== 'paga')
  const totalAReceber = pendentes.reduce((acc, p) => acc + (p.valor - p.valorPago), 0)

  const recebidoMes = parcelas
    .filter((p) => {
      if (!p.pagamentos?.length) return false
      return p.pagamentos.some((pg) => {
        const date = pg.dataPagamento instanceof Timestamp
          ? pg.dataPagamento.toDate()
          : new Date(pg.dataPagamento)
        return date >= startOfMonth
      })
    })
    .reduce((acc, p) => acc + p.pagamentos.reduce((s, pg) => s + pg.valor, 0), 0)

  const vencendo7Dias = parcelas.filter((p) => {
    if (p.status === 'paga') return false
    const date = p.dataVencimento instanceof Timestamp
      ? p.dataVencimento.toDate()
      : new Date(p.dataVencimento)
    return isDueInDays(date, 7)
  })

  const produtosEstoqueBaixo = produtos.filter((p) =>
    Object.values(p.estoque).some((q) => q > 0 && q < 5)
  )

  return {
    totalAReceber,
    recebidoMes,
    vencendo7Dias,
    clientesInadimplentes,
    produtosEstoqueBaixo,
    ultimasVendas,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardData,
    refetchInterval: 60_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total a Receber"
          value={formatCurrency(data?.totalAReceber ?? 0)}
          icon={DollarSign}
          iconColor="text-blue-500"
          bgColor="bg-blue-50 dark:bg-blue-950"
          onClick={() => router.push('/financeiro')}
        />
        <SummaryCard
          title="Recebido no Mês"
          value={formatCurrency(data?.recebidoMes ?? 0)}
          icon={TrendingUp}
          iconColor="text-green-500"
          bgColor="bg-green-50 dark:bg-green-950"
          onClick={() => router.push('/financeiro')}
        />
        <SummaryCard
          title="Vencem em 7 dias"
          value={`${data?.vencendo7Dias.length ?? 0} parcelas`}
          icon={Clock}
          iconColor="text-yellow-500"
          bgColor="bg-yellow-50 dark:bg-yellow-950"
          onClick={() => router.push('/financeiro')}
        />
        <SummaryCard
          title="Inadimplentes"
          value={`${data?.clientesInadimplentes.length ?? 0} clientes`}
          icon={AlertTriangle}
          iconColor="text-red-500"
          bgColor="bg-red-50 dark:bg-red-950"
          onClick={() => router.push('/clientes')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Parcelas Vencendo */}
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => router.push('/financeiro')}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-500" />
              Parcelas Vencendo (7 dias)
            </CardTitle>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {data?.vencendo7Dias.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma parcela vencendo</p>
            ) : (
              <ul className="space-y-2">
                {data?.vencendo7Dias.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium truncate max-w-[180px]">{p.clienteNome}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(p.dataVencimento instanceof Timestamp
                          ? p.dataVencimento.toDate()
                          : new Date(p.dataVencimento))}
                      </p>
                    </div>
                    <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                      {formatCurrency(p.valor - p.valorPago)}
                    </span>
                  </li>
                ))}
                {(data?.vencendo7Dias.length ?? 0) > 5 && (
                  <li className="text-xs text-muted-foreground text-center pt-1">
                    +{(data?.vencendo7Dias.length ?? 0) - 5} mais
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Clientes Inadimplentes */}
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => router.push('/clientes')}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-red-500" />
              Clientes Inadimplentes
            </CardTitle>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {data?.clientesInadimplentes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum cliente inadimplente</p>
            ) : (
              <ul className="space-y-2">
                {data?.clientesInadimplentes.slice(0, 5).map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium truncate max-w-[200px]">{c.nome}</p>
                      <p className="text-xs text-muted-foreground">{c.cidade}</p>
                    </div>
                    <Badge variant="destructive" className="text-xs">Inadimplente</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Estoque Baixo */}
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => router.push('/estoque')}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4 text-orange-500" />
              Estoque Baixo (&lt;5 peças)
            </CardTitle>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {data?.produtosEstoqueBaixo.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Estoque em boas condições</p>
            ) : (
              <ul className="space-y-2">
                {data?.produtosEstoqueBaixo.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <p className="font-medium truncate max-w-[200px]">{p.nome}</p>
                    <div className="flex gap-1 flex-wrap justify-end max-w-[120px]">
                      {(Object.entries(p.estoque) as [string, number][])
                        .filter(([, q]) => q > 0 && q < 5)
                        .map(([t, q]) => (
                          <Badge key={t} variant="outline" className="text-xs text-orange-600 border-orange-300">
                            {t}: {q}
                          </Badge>
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Últimas Vendas */}
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => router.push('/vendas')}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-indigo-500" />
              Últimas Vendas
            </CardTitle>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {data?.ultimasVendas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma venda registrada</p>
            ) : (
              <ul className="space-y-2">
                {data?.ultimasVendas.map((v) => (
                  <li key={v.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium truncate max-w-[180px]">{v.clienteNome}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(v.createdAt instanceof Timestamp
                          ? v.createdAt.toDate()
                          : new Date(v.createdAt))}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatCurrency(v.total)}</p>
                      <StatusBadge status={v.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  iconColor,
  bgColor,
  onClick,
}: {
  title: string
  value: string
  icon: React.ElementType
  iconColor: string
  bgColor: string
  onClick: () => void
}) {
  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-lg font-bold leading-tight">{value}</p>
          </div>
          <div className={`${bgColor} rounded-lg p-2`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    paga: { label: 'Paga', variant: 'default' },
    pendente: { label: 'Pendente', variant: 'secondary' },
    parcialmente_paga: { label: 'Parcial', variant: 'outline' },
    atrasada: { label: 'Atrasada', variant: 'destructive' },
  }
  const s = map[status] ?? { label: status, variant: 'secondary' }
  return <Badge variant={s.variant} className="text-[10px] h-4">{s.label}</Badge>
}

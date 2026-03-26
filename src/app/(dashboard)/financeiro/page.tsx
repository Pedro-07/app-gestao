'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, getDocs, updateDoc, doc, serverTimestamp, Timestamp, addDoc,
  writeBatch, getDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Parcela, FormaPagamento, Configuracoes } from '@/types'
import { formatCurrency, formatDate, isOverdue, isDueInDays, buildWhatsAppUrl } from '@/lib/utils'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Search, MessageCircle, DollarSign, Loader2, CheckCircle2 } from 'lucide-react'

const pagamentoSchema = z.object({
  valor: z.coerce.number().min(0.01, 'Valor obrigatório'),
  formaPagamento: z.enum(['dinheiro', 'pix', 'cartao', 'promissoria']),
  dataPagamento: z.string().min(1, 'Data obrigatória'),
  observacoes: z.string().optional(),
})
type PagamentoForm = z.infer<typeof pagamentoSchema>

async function fetchParcelas(): Promise<Parcela[]> {
  const snap = await getDocs(collection(db, 'parcelas'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Parcela))
}

async function fetchConfig(): Promise<Configuracoes | null> {
  const snap = await getDoc(doc(db, 'config', 'geral'))
  return snap.exists() ? (snap.data() as Configuracoes) : null
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  paga: { label: 'Paga', variant: 'default' },
  pendente: { label: 'Pendente', variant: 'secondary' },
  parcialmente_paga: { label: 'Parcial', variant: 'outline' },
  atrasada: { label: 'Atrasada', variant: 'destructive' },
}

function getDueDate(p: Parcela): Date {
  return p.dataVencimento instanceof Timestamp ? p.dataVencimento.toDate() : new Date(p.dataVencimento)
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((msg, [key, val]) => msg.replaceAll(`{${key}}`, val), template)
}

const defaultTemplateCobranca = `Olá {nome}! 👋\n\nPassando para lembrar sobre a parcela {numero}/{total} no valor de *{valor}* com vencimento em *{vencimento}*.\n\nPor favor, entre em contato para regularizar. Obrigado!`

// Chave de sessão fora do componente para ser estável
const OVERDUE_SESSION_KEY = `overdueUpdated_${new Date().toDateString()}`

export default function FinanceiroPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('todas')
  const [pagamentoDialog, setPagamentoDialog] = useState<Parcela | null>(null)
  const [whatsappDialog, setWhatsappDialog] = useState<{ parcela: Parcela; mensagem: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const overdueUpdatedRef = useRef(
    typeof window !== 'undefined' && !!sessionStorage.getItem(OVERDUE_SESSION_KEY)
  )

  const { data: parcelas = [], isLoading } = useQuery({
    queryKey: ['parcelas'],
    queryFn: fetchParcelas,
  })

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig,
  })

  // Auto-update overdue parcelas status (pendente → atrasada)
  useEffect(() => {
    if (!parcelas.length || overdueUpdatedRef.current) return
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const overdueIds = parcelas.filter((p) => {
      if (p.status !== 'pendente') return false
      return getDueDate(p) < today
    })

    if (!overdueIds.length) return
    overdueUpdatedRef.current = true
    sessionStorage.setItem(OVERDUE_SESSION_KEY, '1')

    const batch = writeBatch(db)
    overdueIds.forEach((p) => {
      batch.update(doc(db, 'parcelas', p.id), { status: 'atrasada', updatedAt: serverTimestamp() })
    })
    batch.commit().then(() => {
      qc.invalidateQueries({ queryKey: ['parcelas'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    })
  }, [parcelas, qc])

  const pending = parcelas.filter((p) => p.status !== 'paga')
  const totalAReceber = pending.reduce((acc, p) => acc + (p.valor - p.valorPago), 0)
  const totalRecebido = parcelas.reduce((acc, p) => acc + p.valorPago, 0)
  const totalAtrasado = parcelas
    .filter((p) => p.status !== 'paga' && isOverdue(getDueDate(p)))
    .reduce((acc, p) => acc + (p.valor - p.valorPago), 0)

  const filtered = parcelas.filter((p) => {
    const matchSearch = p.clienteNome.toLowerCase().includes(search.toLowerCase())
    const dueDate = getDueDate(p)
    const matchTab =
      tab === 'todas' ||
      (tab === 'atrasadas' && p.status !== 'paga' && isOverdue(dueDate)) ||
      (tab === 'hoje' && p.status !== 'paga' && formatDate(dueDate) === formatDate(new Date())) ||
      (tab === '7dias' && p.status !== 'paga' && isDueInDays(dueDate, 7)) ||
      (tab === 'pendentes' && p.status === 'pendente') ||
      (tab === 'pagas' && p.status === 'paga')
    return matchSearch && matchTab
  }).sort((a, b) => getDueDate(a).getTime() - getDueDate(b).getTime())

  const {
    register, handleSubmit, reset, watch, control,
    formState: { errors },
  } = useForm<PagamentoForm>({
    resolver: zodResolver(pagamentoSchema) as any,
    defaultValues: {
      formaPagamento: 'dinheiro',
      dataPagamento: new Date().toISOString().split('T')[0],
    },
  })

  const watchValor = watch('valor')

  async function onRegistrarPagamento(data: PagamentoForm) {
    if (!pagamentoDialog) return
    setSaving(true)
    try {
      const p = pagamentoDialog
      const novoValorPago = p.valorPago + data.valor
      const saldo = p.valor - novoValorPago
      const novoStatus = saldo <= 0 ? 'paga' : 'parcialmente_paga'

      const novoPagamento = {
        id: Date.now().toString(),
        valor: data.valor,
        dataPagamento: Timestamp.fromDate(new Date(data.dataPagamento + 'T12:00:00')),
        formaPagamento: data.formaPagamento as FormaPagamento,
        observacoes: data.observacoes ?? '',
      }

      await updateDoc(doc(db, 'parcelas', p.id), {
        valorPago: novoValorPago,
        status: novoStatus,
        pagamentos: [...(p.pagamentos ?? []), novoPagamento],
        updatedAt: serverTimestamp(),
      })

      qc.invalidateQueries({ queryKey: ['parcelas'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Pagamento registrado!')
      setPagamentoDialog(null)
      reset()
    } catch {
      toast.error('Erro ao registrar pagamento')
    } finally {
      setSaving(false)
    }
  }

  function openCobrancaWhatsapp(p: Parcela) {
    const dueDate = getDueDate(p)
    const restante = p.valor - p.valorPago
    const template = config?.templateCobranca ?? defaultTemplateCobranca
    const msg = applyTemplate(template, {
      nome: p.clienteNome,
      valor: formatCurrency(restante),
      vencimento: formatDate(dueDate),
      numero: String(p.numero === 0 ? 'Entrada' : p.numero),
      total: String(p.totalParcelas),
    })
    setWhatsappDialog({ parcela: p, mensagem: msg })
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">A Receber</p>
            <p className="text-xl font-bold text-blue-600">{formatCurrency(totalAReceber)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Recebido</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(totalRecebido)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Em Atraso</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalAtrasado)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por cliente..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="todas">Todas</TabsTrigger>
          <TabsTrigger value="atrasadas" className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">Atrasadas</TabsTrigger>
          <TabsTrigger value="hoje">Hoje</TabsTrigger>
          <TabsTrigger value="7dias">7 dias</TabsTrigger>
          <TabsTrigger value="pendentes">Pendentes</TabsTrigger>
          <TabsTrigger value="pagas">Pagas</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-3">
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma parcela encontrada.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((p) => {
                const dueDate = getDueDate(p)
                const overdue = p.status !== 'paga' && isOverdue(dueDate)
                const s = overdue ? statusConfig.atrasada : statusConfig[p.status] ?? statusConfig.pendente
                const restante = p.valor - p.valorPago

                return (
                  <Card key={p.id} className={overdue ? 'border-red-300 dark:border-red-800' : ''}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium truncate">{p.clienteNome}</p>
                            <Badge variant={s.variant} className="text-xs">{s.label}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Parcela {p.numero === 0 ? 'Entrada' : `${p.numero}/${p.totalParcelas}`} ·
                            Vence: {formatDate(dueDate)}
                          </p>
                          {p.valorPago > 0 && p.valorPago < p.valor && (
                            <p className="text-xs text-muted-foreground">
                              Pago: {formatCurrency(p.valorPago)} · Restante: {formatCurrency(restante)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <div className="text-right mr-2">
                            <p className="font-bold">{formatCurrency(p.status === 'paga' ? p.valor : restante)}</p>
                          </div>
                          {p.status !== 'paga' && (
                            <>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8"
                                onClick={() => openCobrancaWhatsapp(p)}
                                title="Cobrar via WhatsApp"
                              >
                                <MessageCircle className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8"
                                onClick={() => {
                                  setPagamentoDialog(p)
                                  reset({
                                    valor: p.valor - p.valorPago,
                                    formaPagamento: 'dinheiro',
                                    dataPagamento: new Date().toISOString().split('T')[0],
                                  })
                                }}
                                title="Registrar pagamento"
                              >
                                <CheckCircle2 className="h-4 w-4 text-blue-600" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Pagamento Dialog */}
      <Dialog open={!!pagamentoDialog} onOpenChange={() => setPagamentoDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Registrar Pagamento
            </DialogTitle>
          </DialogHeader>
          {pagamentoDialog && (
            <div className="text-sm text-muted-foreground mb-2">
              <p><strong>{pagamentoDialog.clienteNome}</strong></p>
              <p>Parcela {pagamentoDialog.numero === 0 ? 'Entrada' : `${pagamentoDialog.numero}/${pagamentoDialog.totalParcelas}`} · Valor: {formatCurrency(pagamentoDialog.valor - pagamentoDialog.valorPago)}</p>
            </div>
          )}
          <form onSubmit={handleSubmit(onRegistrarPagamento as any)} className="space-y-4">
            <div className="space-y-1">
              <Label>Valor Pago (R$) *</Label>
              <Input
                type="number" step="0.01" min="0.01" placeholder="0,00"
                {...register('valor')}
                onKeyPress={(e) => { if (!/[\d.,]/.test(e.key)) e.preventDefault() }}
              />
              {errors.valor && <p className="text-xs text-destructive">{errors.valor.message}</p>}
              {pagamentoDialog && watchValor > 0 && watchValor < (pagamentoDialog.valor - pagamentoDialog.valorPago) && (
                <p className="text-xs text-yellow-600">Pagamento parcial — restará {formatCurrency((pagamentoDialog.valor - pagamentoDialog.valorPago) - watchValor)}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Data do Pagamento *</Label>
              <Input type="date" {...register('dataPagamento')} />
            </div>
            <div className="space-y-1">
              <Label>Forma de Pagamento</Label>
              <Controller
                name="formaPagamento"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dinheiro">Dinheiro</SelectItem>
                      <SelectItem value="pix">PIX</SelectItem>
                      <SelectItem value="cartao">Cartão</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea rows={2} {...register('observacoes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPagamentoDialog(null)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Dialog */}
      <Dialog open={!!whatsappDialog} onOpenChange={() => setWhatsappDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Cobrar via WhatsApp</DialogTitle></DialogHeader>
          {whatsappDialog && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Mensagem (editável)</Label>
                <Textarea
                  rows={8}
                  value={whatsappDialog.mensagem}
                  onChange={(e) => setWhatsappDialog({ ...whatsappDialog, mensagem: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setWhatsappDialog(null)}>Cancelar</Button>
                <Button
                  onClick={() => {
                    const url = buildWhatsAppUrl(whatsappDialog.parcela.clienteTelefone, whatsappDialog.mensagem)
                    window.open(url, '_blank')
                    setWhatsappDialog(null)
                  }}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Abrir WhatsApp
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, getDocs, serverTimestamp,
  orderBy, query as fsQuery, Timestamp, writeBatch, doc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Cliente, Produto, Venda, Tamanho } from '@/types'
import { formatCurrency, formatDate, generateInstallments } from '@/lib/utils'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Combobox } from '@/components/shared/combobox'
import { Plus, Search, Loader2, Trash2, ShoppingCart, CheckCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

const TAMANHOS: Tamanho[] = ['PP', 'P', 'M', 'G', 'GG', 'XGG']

const itemSchema = z.object({
  produtoId: z.string().min(1, 'Selecione um produto'),
  produtoNome: z.string(),
  tamanho: z.enum(['PP', 'P', 'M', 'G', 'GG', 'XGG']),
  quantidade: z.coerce.number().min(1, 'Mínimo 1'),
  precoUnitario: z.coerce.number().min(0.01),
  subtotal: z.coerce.number(),
})

const vendaSchema = z.object({
  clienteId: z.string().min(1, 'Selecione um cliente'),
  clienteNome: z.string(),
  clienteCidade: z.string(),
  itens: z.array(itemSchema).min(1, 'Adicione pelo menos 1 produto'),
  formaPagamento: z.enum(['dinheiro', 'pix', 'cartao', 'promissoria']),
  entrada: z.coerce.number().min(0).optional(),
  numeroParcelas: z.coerce.number().min(1).max(60).optional(),
  primeiroVencimento: z.string().optional(),
  intervaloParcelas: z.enum(['30', '15', '10']).optional(),
  observacoes: z.string().optional(),
})

type VendaForm = z.infer<typeof vendaSchema>

async function fetchVendasData() {
  const [vendasSnap, clientesSnap] = await Promise.all([
    getDocs(fsQuery(collection(db, 'vendas'), orderBy('createdAt', 'desc'))),
    getDocs(fsQuery(collection(db, 'clientes'), orderBy('nome'))),
  ])
  return {
    vendas: vendasSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Venda)),
    clientes: clientesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente)),
  }
}

const statusMap: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  paga: { label: 'Paga', variant: 'default' },
  pendente: { label: 'Pendente', variant: 'secondary' },
  parcialmente_paga: { label: 'Parcial', variant: 'outline' },
  atrasada: { label: 'Atrasada', variant: 'destructive' },
  cancelada: { label: 'Cancelada', variant: 'outline' },
}

export default function VendasPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<VendaForm | null>(null)
  const [editableDates, setEditableDates] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)

  const { data, isLoading } = useQuery({ queryKey: ['vendas'], queryFn: fetchVendasData })

  const { data: produtos = [] } = useQuery<Produto[]>({
    queryKey: ['produtos'],
    queryFn: async () => {
      const snap = await getDocs(fsQuery(collection(db, 'produtos'), orderBy('nome')))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Produto))
    },
  })

  const vendas = data?.vendas ?? []
  const clientes = data?.clientes ?? []

  const filtered = vendas.filter((v) => {
    const matchSearch = v.clienteNome.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'todos' || v.status === statusFilter
    return matchSearch && matchStatus
  })

  const {
    register, handleSubmit, control, reset, watch, setValue,
    formState: { errors },
  } = useForm<VendaForm>({
    resolver: zodResolver(vendaSchema) as any,
    defaultValues: { formaPagamento: 'dinheiro', itens: [], entrada: 0, numeroParcelas: 1, intervaloParcelas: '30' },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'itens' })
  const watchItens = watch('itens')
  const watchFP = watch('formaPagamento')
  const watchEntrada = watch('entrada') ?? 0
  const watchNumeroParcelas = watch('numeroParcelas') ?? 1
  const watchPrimeiroVencimento = watch('primeiroVencimento')
  const watchIntervalo = watch('intervaloParcelas') ?? '30'
  const total = watchItens.reduce((acc, item) => acc + (item.subtotal ?? 0), 0)

  function addItem() {
    append({ produtoId: '', produtoNome: '', tamanho: 'M', quantidade: 1, precoUnitario: 0, subtotal: 0 })
  }

  function onProdutoChange(index: number, produtoId: string) {
    const produto = produtos.find((p) => p.id === produtoId)
    if (produto) {
      setValue(`itens.${index}.produtoNome`, produto.nome)
      setValue(`itens.${index}.precoUnitario`, produto.precoVenda)
      const qty = watchItens[index]?.quantidade ?? 1
      setValue(`itens.${index}.subtotal`, produto.precoVenda * qty)
    }
  }

  function onQtyChange(index: number, qty: number) {
    const price = watchItens[index]?.precoUnitario ?? 0
    setValue(`itens.${index}.subtotal`, price * qty)
  }

  // Sync editableDates when confirmState/parcelasPreview change
  useEffect(() => {
    if (confirmState?.formaPagamento === 'promissoria') {
      const intervalDays = parseInt(confirmState.intervaloParcelas ?? '30', 10)
      if (confirmState.numeroParcelas && confirmState.primeiroVencimento) {
        const preview = generateInstallments(
          total,
          confirmState.numeroParcelas,
          new Date(confirmState.primeiroVencimento + 'T12:00:00'),
          confirmState.entrada ?? 0,
          intervalDays
        )
        setEditableDates(preview.map((p) => p.dueDate.toISOString().split('T')[0]))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmState])

  // Step 1: validate form and show confirmation
  function handleFormSubmit(data: VendaForm) {
    const entrada = data.entrada ?? 0
    if (data.formaPagamento === 'promissoria') {
      if (entrada >= total) {
        toast.error('A entrada deve ser menor que o total da venda')
        return
      }
      if (!data.primeiroVencimento) {
        toast.error('Informe a data da 1ª parcela')
        return
      }
    }
    setConfirmState(data)
  }

  // Step 2: execute batch after confirmation
  async function executeVenda(data: VendaForm) {
    if (submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    try {
      const batch = writeBatch(db)

      for (const item of data.itens) {
        const produto = produtos.find((p) => p.id === item.produtoId)
        if (!produto) throw new Error('Produto não encontrado')
        const estoqueDisp = produto.estoque[item.tamanho] ?? 0
        if (estoqueDisp < item.quantidade) {
          throw new Error(`Estoque insuficiente: ${produto.nome} tamanho ${item.tamanho} (disponível: ${estoqueDisp})`)
        }
      }

      const isPromissoria = data.formaPagamento === 'promissoria'
      const status = isPromissoria ? 'pendente' : 'paga'
      const vendaRef = doc(collection(db, 'vendas'))

      batch.set(vendaRef, {
        clienteId: data.clienteId, clienteNome: data.clienteNome, clienteCidade: data.clienteCidade,
        itens: data.itens, total, formaPagamento: data.formaPagamento,
        entrada: data.entrada ?? 0, numeroParcelas: data.numeroParcelas ?? 1,
        observacoes: data.observacoes ?? '', status,
        dataVenda: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })

      for (const item of data.itens) {
        const produto = produtos.find((p) => p.id === item.produtoId)!
        const novoEstoque = { ...produto.estoque }
        novoEstoque[item.tamanho] -= item.quantidade
        batch.update(doc(db, 'produtos', item.produtoId), { estoque: novoEstoque, updatedAt: serverTimestamp() })
        const movRef = doc(collection(db, 'movimentacoes'))
        batch.set(movRef, {
          produtoId: item.produtoId, produtoNome: item.produtoNome,
          tipo: 'saida', tamanho: item.tamanho, quantidade: item.quantidade,
          motivo: 'Venda', vendaId: vendaRef.id, createdAt: serverTimestamp(),
        })
      }

      if (isPromissoria && data.numeroParcelas && data.primeiroVencimento) {
        const intervalDays = parseInt(data.intervaloParcelas ?? '30', 10)
        const firstDate = new Date(data.primeiroVencimento + 'T12:00:00')
        const parcelas = generateInstallments(total, data.numeroParcelas, firstDate, data.entrada ?? 0, intervalDays)
        const cliente = clientes.find((c) => c.id === data.clienteId)

        for (let i = 0; i < parcelas.length; i++) {
          const p = parcelas[i]
          // Use the user-edited date if available
          const dueDateStr = editableDates[i]
          const dueDate = dueDateStr ? new Date(dueDateStr + 'T12:00:00') : p.dueDate
          const parcelaRef = doc(collection(db, 'parcelas'))
          batch.set(parcelaRef, {
            vendaId: vendaRef.id, clienteId: data.clienteId, clienteNome: data.clienteNome,
            clienteTelefone: cliente?.telefone ?? '', numero: p.number,
            totalParcelas: data.numeroParcelas, valor: p.value, valorPago: 0,
            dataVencimento: Timestamp.fromDate(dueDate), status: 'pendente',
            pagamentos: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          })
        }

        if ((data.entrada ?? 0) > 0) {
          const entradaRef = doc(collection(db, 'parcelas'))
          batch.set(entradaRef, {
            vendaId: vendaRef.id, clienteId: data.clienteId, clienteNome: data.clienteNome,
            clienteTelefone: clientes.find((c) => c.id === data.clienteId)?.telefone ?? '',
            numero: 0, totalParcelas: data.numeroParcelas, valor: data.entrada, valorPago: data.entrada,
            dataVencimento: Timestamp.fromDate(new Date()), status: 'paga',
            pagamentos: [{ id: 'entrada', valor: data.entrada, dataPagamento: Timestamp.fromDate(new Date()), formaPagamento: 'dinheiro', observacoes: 'Entrada' }],
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          })
        }
      }

      await batch.commit()
      qc.invalidateQueries({ queryKey: ['vendas'] })
      qc.invalidateQueries({ queryKey: ['produtos'] })
      qc.invalidateQueries({ queryKey: ['parcelas'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Venda registrada com sucesso!')
      setConfirmState(null)
      setDialogOpen(false)
      reset()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao registrar venda')
    } finally {
      setSaving(false)
      submittingRef.current = false
    }
  }

  const clienteOptions = clientes.map((c) => ({
    value: c.id,
    label: c.nome,
    sublabel: `${c.cidade}${c.codigo ? ` · ${c.codigo}` : ''}`,
  }))
  const produtoOptions = produtos.map((p) => ({ value: p.id, label: p.nome, sublabel: p.categoria }))

  // Preview installments for confirmation dialog (values only, dates come from editableDates)
  const parcelasPreview = confirmState?.formaPagamento === 'promissoria' && confirmState.numeroParcelas && confirmState.primeiroVencimento
    ? generateInstallments(
        total,
        confirmState.numeroParcelas,
        new Date(confirmState.primeiroVencimento + 'T12:00:00'),
        confirmState.entrada ?? 0,
        parseInt(confirmState.intervaloParcelas ?? '30', 10)
      )
    : []

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por cliente..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="paga">Paga</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="parcialmente_paga">Parcial</SelectItem>
            <SelectItem value="atrasada">Atrasada</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => { reset(); setDialogOpen(true) }} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />Nova Venda
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} venda(s)</p>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma venda encontrada.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((v) => {
            const s = statusMap[v.status] ?? { label: v.status, variant: 'secondary' as const }
            return (
              <Card key={v.id} className="cursor-pointer hover:shadow-sm" onClick={() => router.push(`/vendas/${v.id}`)}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">{v.clienteNome}</p>
                        <Badge variant={s.variant} className="text-xs shrink-0">{s.label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {v.clienteCidade} · {formatDate(v.createdAt instanceof Timestamp ? v.createdAt.toDate() : new Date(v.createdAt))}
                        {v.formaPagamento === 'promissoria' ? ` · ${v.numeroParcelas}x` : ' · À vista'}
                      </p>
                    </div>
                    <p className="font-bold text-lg shrink-0">{formatCurrency(v.total)}</p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Nova Venda Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setConfirmState(null) } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />Nova Venda
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(handleFormSubmit as any)} className="space-y-5">
            {/* Cliente */}
            <div className="space-y-1">
              <Label>Cliente *</Label>
              <Controller
                name="clienteId"
                control={control}
                render={({ field }) => (
                  <Combobox
                    options={clienteOptions}
                    value={field.value ?? ''}
                    onSelect={(v: string) => {
                      field.onChange(v)
                      const c = clientes.find((cl) => cl.id === v)
                      if (c) { setValue('clienteNome', c.nome); setValue('clienteCidade', c.cidade) }
                    }}
                    placeholder="Selecione ou busque um cliente..."
                    searchPlaceholder="Digite o nome, cidade ou código..."
                  />
                )}
              />
              {errors.clienteId && <p className="text-xs text-destructive">{errors.clienteId.message}</p>}
            </div>

            <Separator />

            {/* Itens */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Produtos *</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-4 w-4 mr-1" />Adicionar
                </Button>
              </div>

              {fields.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg border-dashed">
                  Clique em &quot;Adicionar&quot; para inserir produtos
                </p>
              )}

              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={field.id} className="border rounded-lg p-3 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Produto</Label>
                      <Controller
                        name={`itens.${index}.produtoId`}
                        control={control}
                        render={({ field: f }) => (
                          <Combobox
                            options={produtoOptions}
                            value={f.value ?? ''}
                            onSelect={(v: string) => { f.onChange(v); onProdutoChange(index, v) }}
                            placeholder="Selecione ou busque..."
                            searchPlaceholder="Digite o nome do produto..."
                          />
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Tamanho</Label>
                        <Controller
                          name={`itens.${index}.tamanho`}
                          control={control}
                          render={({ field: f }) => (
                            <Select value={f.value} onValueChange={f.onChange}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {TAMANHOS.map((t) => {
                                  const produto = produtos.find((p) => p.id === watchItens[index]?.produtoId)
                                  const qty = produto?.estoque[t] ?? 0
                                  return (
                                    <SelectItem key={t} value={t} disabled={qty === 0}>
                                      {t} {qty === 0 ? '(sem estoque)' : `(${qty})`}
                                    </SelectItem>
                                  )
                                })}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Quantidade</Label>
                        <Input
                          type="number" min="1" className="h-8"
                          {...register(`itens.${index}.quantidade`)}
                          onChange={(e) => {
                            register(`itens.${index}.quantidade`).onChange(e)
                            onQtyChange(index, Number(e.target.value))
                          }}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Subtotal</Label>
                        <div className="h-8 flex items-center px-3 border rounded-lg bg-muted text-sm font-semibold">
                          {formatCurrency(watchItens[index]?.subtotal ?? 0)}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <p className="text-xs text-muted-foreground">
                        Preço unit.: {formatCurrency(watchItens[index]?.precoUnitario ?? 0)}
                      </p>
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-destructive hover:text-destructive" onClick={() => remove(index)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" />Remover
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {errors.itens && <p className="text-xs text-destructive">{errors.itens.message}</p>}

              {fields.length > 0 && (
                <div className="flex justify-end">
                  <p className="text-lg font-bold">Total: {formatCurrency(total)}</p>
                </div>
              )}
            </div>

            <Separator />

            {/* Pagamento */}
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Forma de Pagamento *</Label>
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
                        <SelectItem value="promissoria">Nota Promissória / Parcelado</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              {watchFP === 'promissoria' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label>Entrada (R$)</Label>
                      <Input type="number" step="0.01" min="0" {...register('entrada')} />
                    </div>
                    <div className="space-y-1">
                      <Label>Nº Parcelas *</Label>
                      <Input type="number" min="1" max="60" {...register('numeroParcelas')} />
                    </div>
                    <div className="space-y-1">
                      <Label>1ª Parcela *</Label>
                      <Input type="date" {...register('primeiroVencimento')} />
                    </div>
                    <div className="space-y-1">
                      <Label>Intervalo</Label>
                      <Controller
                        name="intervaloParcelas"
                        control={control}
                        render={({ field }) => (
                          <Select value={field.value ?? '30'} onValueChange={field.onChange}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="30">30 dias</SelectItem>
                              <SelectItem value="15">15 dias</SelectItem>
                              <SelectItem value="10">10 dias</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                  </div>
                  {watchEntrada >= 0 && total > 0 && watchNumeroParcelas > 0 && (
                    <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                      Restante a parcelar: <strong>{formatCurrency(total - watchEntrada)}</strong>
                      {` → ${watchNumeroParcelas}x de ${formatCurrency((total - watchEntrada) / watchNumeroParcelas)}`}
                      {watchIntervalo !== '30' && ` · a cada ${watchIntervalo} dias`}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <Label>Observações</Label>
                <Textarea placeholder="Notas sobre a venda..." rows={2} {...register('observacoes')} />
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Revisar Venda
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmState} onOpenChange={(open) => { if (!open) setConfirmState(null) }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Confirmar Venda
            </DialogTitle>
          </DialogHeader>

          {confirmState && (
            <div className="space-y-4">
              {/* Cliente */}
              <div>
                <p className="text-xs text-muted-foreground">Cliente</p>
                <p className="font-semibold">{confirmState.clienteNome}</p>
                <p className="text-sm text-muted-foreground">{confirmState.clienteCidade}</p>
              </div>

              <Separator />

              {/* Itens */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Itens</p>
                {confirmState.itens.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {item.produtoNome} — {item.tamanho} × {item.quantidade}
                    </span>
                    <span className="font-medium">{formatCurrency(item.subtotal)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-1 border-t text-base">
                  <span>Total</span>
                  <span>{formatCurrency(total)}</span>
                </div>
              </div>

              <Separator />

              {/* Pagamento */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pagamento</p>
                <p className="text-sm">
                  {confirmState.formaPagamento === 'promissoria' ? 'Nota Promissória' :
                   confirmState.formaPagamento === 'dinheiro' ? 'Dinheiro' :
                   confirmState.formaPagamento === 'pix' ? 'PIX' : 'Cartão'}
                </p>
              </div>

              {/* Parcelas preview with editable dates */}
              {confirmState.formaPagamento === 'promissoria' && parcelasPreview.length > 0 && (
                <div className="space-y-2">
                  {(confirmState.entrada ?? 0) > 0 && (
                    <div className="flex justify-between text-sm py-1">
                      <span className="text-muted-foreground">Entrada (hoje)</span>
                      <span className="font-medium text-green-600">{formatCurrency(confirmState.entrada ?? 0)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Parcelas {confirmState.intervaloParcelas !== '30' ? `(a cada ${confirmState.intervaloParcelas} dias)` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">Ajuste as datas se necessário</p>
                  </div>
                  {parcelasPreview.map((p, i) => (
                    <div key={p.number} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground shrink-0 w-8">{p.number}/{confirmState.numeroParcelas}</span>
                      <input
                        type="date"
                        value={editableDates[i] ?? ''}
                        onChange={(e) => {
                          const next = [...editableDates]
                          next[i] = e.target.value
                          setEditableDates(next)
                        }}
                        className="flex-1 text-xs border rounded px-2 py-1 bg-background"
                      />
                      <span className="font-medium shrink-0">{formatCurrency(p.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmState(null)}>Voltar</Button>
            <Button
              onClick={() => confirmState && executeVenda(confirmState)}
              disabled={saving}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Finalizar Venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

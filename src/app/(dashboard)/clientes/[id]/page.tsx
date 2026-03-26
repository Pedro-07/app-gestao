'use client'

import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, collection, query, where, getDocs, orderBy, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Cliente, Venda, Parcela, ClienteStatus } from '@/types'
import { formatCurrency, formatDate, formatPhone, buildWhatsAppUrl, maskPhone, maskCPFCNPJ, onlyLetters, isValidCPF, isValidCNPJ } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ArrowLeft, MessageCircle, ShoppingCart, Pencil, Loader2 } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'

const editSchema = z.object({
  nome: z.string().min(3, 'Mínimo 3 caracteres').regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Apenas letras e espaços'),
  cpfCnpj: z.string().refine((v) => {
    const d = v.replace(/\D/g, '')
    return d.length === 11 ? isValidCPF(v) : d.length === 14 ? isValidCNPJ(v) : false
  }, 'CPF ou CNPJ inválido'),
  telefone: z.string().refine((v) => {
    const d = v.replace(/\D/g, '')
    return d.length >= 10 && d.length <= 11
  }, 'Telefone inválido'),
  cidade: z.string().min(2).regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Apenas letras'),
  endereco: z.string().min(5, 'Endereço completo obrigatório'),
  observacoes: z.string().optional(),
  status: z.enum(['ativo', 'inadimplente', 'inativo']),
  motivoInadimplencia: z.string().optional(),
})
type EditForm = z.infer<typeof editSchema>

const statusMap: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  paga: { label: 'Paga', variant: 'default' },
  pendente: { label: 'Pendente', variant: 'secondary' },
  parcialmente_paga: { label: 'Parcial', variant: 'outline' },
  atrasada: { label: 'Atrasada', variant: 'destructive' },
}

async function fetchClienteData(id: string) {
  const [clienteSnap, vendasSnap, parcelasSnap] = await Promise.all([
    getDoc(doc(db, 'clientes', id)),
    getDocs(query(collection(db, 'vendas'), where('clienteId', '==', id), orderBy('createdAt', 'desc'))),
    getDocs(query(collection(db, 'parcelas'), where('clienteId', '==', id))),
  ])
  const cliente = clienteSnap.exists() ? ({ id: clienteSnap.id, ...clienteSnap.data() } as Cliente) : null
  const vendas = vendasSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Venda))
  const parcelas = parcelasSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Parcela))
  return { cliente, vendas, parcelas }
}

export default function ClienteDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['cliente', id],
    queryFn: () => fetchClienteData(id),
  })

  const { register, handleSubmit, reset, setValue, watch, control, formState: { errors } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { status: 'ativo' },
  })

  const statusWatch = watch('status')

  function openEdit(c: Cliente) {
    reset({
      nome: c.nome, cpfCnpj: c.cpfCnpj, telefone: c.telefone,
      cidade: c.cidade, endereco: c.endereco, observacoes: c.observacoes ?? '',
      status: c.status, motivoInadimplencia: c.motivoInadimplencia ?? '',
    })
    setEditOpen(true)
  }

  async function onSubmit(formData: EditForm) {
    setSaving(true)
    try {
      await updateDoc(doc(db, 'clientes', id), { ...formData, updatedAt: serverTimestamp() })
      qc.invalidateQueries({ queryKey: ['cliente', id] })
      qc.invalidateQueries({ queryKey: ['clientes'] })
      toast.success('Cliente atualizado!')
      setEditOpen(false)
    } catch {
      toast.error('Erro ao atualizar cliente')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  const { cliente, vendas, parcelas } = data ?? {}
  if (!cliente) return <p className="text-muted-foreground">Cliente não encontrado.</p>

  const totalComprado = vendas?.reduce((acc, v) => acc + v.total, 0) ?? 0
  const saldoDevedor = parcelas
    ?.filter((p) => p.status !== 'paga')
    .reduce((acc, p) => acc + (p.valor - p.valorPago), 0) ?? 0

  const clienteStatus = {
    ativo: { label: 'Ativo', variant: 'default' as const },
    inadimplente: { label: 'Inadimplente', variant: 'destructive' as const },
    inativo: { label: 'Inativo', variant: 'secondary' as const },
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Button variant="ghost" onClick={() => router.back()} className="-ml-2">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Voltar
      </Button>

      {/* Cliente Info */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-xl">{cliente.nome}</CardTitle>
                {cliente.codigo && (
                  <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{cliente.codigo}</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{cliente.cidade} · {formatPhone(cliente.telefone)}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={clienteStatus[cliente.status].variant}>
                {clienteStatus[cliente.status].label}
              </Badge>
              <Button
                size="sm" variant="outline"
                onClick={() => openEdit(cliente)}
              >
                <Pencil className="h-4 w-4 mr-1" />
                Editar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(buildWhatsAppUrl(cliente.telefone, `Olá ${cliente.nome}!`), '_blank')}
              >
                <MessageCircle className="h-4 w-4 mr-1 text-green-600" />
                WhatsApp
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Endereço:</span> {cliente.endereco}</p>
          {cliente.observacoes && (
            <p><span className="text-muted-foreground">Obs:</span> {cliente.observacoes}</p>
          )}
          {cliente.motivoInadimplencia && (
            <p className="text-destructive"><span className="font-medium">Inadimplência:</span> {cliente.motivoInadimplencia}</p>
          )}
        </CardContent>
      </Card>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-bold">{vendas?.length ?? 0}</p>
            <p className="text-sm text-muted-foreground">Compras</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-bold text-green-600">{formatCurrency(totalComprado)}</p>
            <p className="text-sm text-muted-foreground">Total comprado</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className={`text-2xl font-bold ${saldoDevedor > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {formatCurrency(saldoDevedor)}
            </p>
            <p className="text-sm text-muted-foreground">Em aberto</p>
          </CardContent>
        </Card>
      </div>

      {/* Histórico de Vendas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="h-4 w-4" />
            Histórico de Compras
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vendas?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhuma compra registrada</p>
          ) : (
            <div className="space-y-2">
              {vendas?.map((v) => {
                const s = statusMap[v.status] ?? { label: v.status, variant: 'secondary' as const }
                return (
                  <div
                    key={v.id}
                    className="flex items-center justify-between py-2 border-b last:border-0 cursor-pointer hover:bg-muted/50 px-2 rounded"
                    onClick={() => router.push(`/vendas/${v.id}`)}
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {formatDate(v.createdAt instanceof Timestamp ? v.createdAt.toDate() : new Date(v.createdAt))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {v.itens.length} item(s) · {v.formaPagamento === 'promissoria' ? `${v.numeroParcelas}x` : 'À vista'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatCurrency(v.total)}</p>
                      <Badge variant={s.variant} className="text-xs">{s.label}</Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Cliente</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>Nome completo *</Label>
              <Input
                {...register('nome')}
                onChange={(e) => setValue('nome', onlyLetters(e.target.value))}
              />
              {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>CPF / CNPJ *</Label>
                <Input
                  {...register('cpfCnpj')}
                  onChange={(e) => setValue('cpfCnpj', maskCPFCNPJ(e.target.value))}
                  maxLength={18}
                />
                {errors.cpfCnpj && <p className="text-xs text-destructive">{errors.cpfCnpj.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Telefone (WhatsApp) *</Label>
                <Input
                  {...register('telefone')}
                  onChange={(e) => setValue('telefone', maskPhone(e.target.value))}
                  maxLength={15}
                />
                {errors.telefone && <p className="text-xs text-destructive">{errors.telefone.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Cidade *</Label>
                <Input
                  {...register('cidade')}
                  onChange={(e) => setValue('cidade', onlyLetters(e.target.value))}
                />
                {errors.cidade && <p className="text-xs text-destructive">{errors.cidade.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Status *</Label>
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(v: string) => field.onChange(v as ClienteStatus)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ativo">Ativo</SelectItem>
                        <SelectItem value="inadimplente">Inadimplente</SelectItem>
                        <SelectItem value="inativo">Inativo</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Endereço completo *</Label>
              <Input {...register('endereco')} />
              {errors.endereco && <p className="text-xs text-destructive">{errors.endereco.message}</p>}
            </div>
            {statusWatch === 'inadimplente' && (
              <div className="space-y-1">
                <Label>Motivo da inadimplência</Label>
                <Input {...register('motivoInadimplencia')} />
              </div>
            )}
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea rows={3} {...register('observacoes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

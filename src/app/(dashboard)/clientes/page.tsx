'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy, query as fsQuery,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Cliente, ClienteStatus, Parcela } from '@/types'
import { maskCPFCNPJ, maskPhone, onlyLetters, isValidCPF, isValidCNPJ, generateClientCode, formatCurrency } from '@/lib/utils'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Search, MoreVertical, Pencil, Trash2, MessageCircle, AlertTriangle, Eye, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { buildWhatsAppUrl, formatPhone, formatCPFCNPJ } from '@/lib/utils'

// ─── Schema ───────────────────────────────────────────────────────────────────
const clienteSchema = z.object({
  nome: z.string().min(3, 'Mínimo 3 caracteres').regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Apenas letras e espaços'),
  cpfCnpj: z.string().refine((v) => {
    const d = v.replace(/\D/g, '')
    return d.length === 11 ? isValidCPF(v) : d.length === 14 ? isValidCNPJ(v) : false
  }, 'CPF ou CNPJ inválido'),
  telefone: z.string().refine((v) => {
    const d = v.replace(/\D/g, '')
    return d.length >= 10 && d.length <= 11
  }, 'Telefone inválido — informe DDD + número'),
  cidade: z.string().min(2, 'Cidade obrigatória').regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Apenas letras'),
  endereco: z.string().min(5, 'Endereço completo obrigatório'),
  observacoes: z.string().optional(),
  status: z.enum(['ativo', 'inadimplente', 'inativo']),
  motivoInadimplencia: z.string().optional(),
})

type ClienteForm = z.infer<typeof clienteSchema>

async function fetchClientes(): Promise<Cliente[]> {
  const snap = await getDocs(fsQuery(collection(db, 'clientes'), orderBy('nome')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente))
}

const statusConfig: Record<ClienteStatus, { label: string; variant: 'default' | 'destructive' | 'secondary' }> = {
  ativo: { label: 'Ativo', variant: 'default' },
  inadimplente: { label: 'Inadimplente', variant: 'destructive' },
  inativo: { label: 'Inativo', variant: 'secondary' },
}

export default function ClientesPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [cidadeFilter, setCidadeFilter] = useState('todas')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<Cliente | null>(null)

  const { data: clientes = [], isLoading } = useQuery({ queryKey: ['clientes'], queryFn: fetchClientes })

  const { data: parcelas = [] } = useQuery<Parcela[]>({
    queryKey: ['parcelas'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'parcelas'))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Parcela))
    },
  })

  function getSaldoDevedor(clienteId: string): number {
    return parcelas
      .filter((p) => p.clienteId === clienteId && p.status !== 'paga')
      .reduce((acc, p) => acc + (p.valor - p.valorPago), 0)
  }

  const cidades = Array.from(new Set(clientes.map((c) => c.cidade))).sort()

  const filtered = clientes.filter((c) => {
    const matchSearch =
      c.nome.toLowerCase().includes(search.toLowerCase()) ||
      c.cpfCnpj.replace(/\D/g, '').includes(search.replace(/\D/g, '')) ||
      c.telefone.replace(/\D/g, '').includes(search.replace(/\D/g, ''))
    const matchCidade = cidadeFilter === 'todas' || c.cidade === cidadeFilter
    const matchStatus = statusFilter === 'todos' || c.status === statusFilter
    return matchSearch && matchCidade && matchStatus
  })

  const { register, handleSubmit, reset, setValue, watch, control, formState: { errors } } = useForm<ClienteForm>({
    resolver: zodResolver(clienteSchema),
    defaultValues: { status: 'ativo' },
  })

  const statusWatch = watch('status')

  function openNew() {
    setEditingCliente(null)
    reset({ status: 'ativo', nome: '', cpfCnpj: '', telefone: '', cidade: '', endereco: '', observacoes: '', motivoInadimplencia: '' })
    setDialogOpen(true)
  }

  function openEdit(c: Cliente) {
    setEditingCliente(c)
    reset({
      nome: c.nome, cpfCnpj: c.cpfCnpj, telefone: c.telefone,
      cidade: c.cidade, endereco: c.endereco, observacoes: c.observacoes ?? '',
      status: c.status, motivoInadimplencia: c.motivoInadimplencia ?? '',
    })
    setDialogOpen(true)
  }

  async function onSubmit(data: ClienteForm) {
    setSaving(true)
    try {
      if (editingCliente) {
        await updateDoc(doc(db, 'clientes', editingCliente.id), { ...data, updatedAt: serverTimestamp() })
        toast.success('Cliente atualizado!')
      } else {
        const existingCodes = clientes.map((c) => c.codigo ?? '')
        const codigo = generateClientCode(existingCodes)
        await addDoc(collection(db, 'clientes'), { ...data, codigo, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        toast.success('Cliente cadastrado!')
      }
      qc.invalidateQueries({ queryKey: ['clientes'] })
      setDialogOpen(false)
    } catch {
      toast.error('Erro ao salvar cliente')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(c: Cliente) {
    try {
      await deleteDoc(doc(db, 'clientes', c.id))
      qc.invalidateQueries({ queryKey: ['clientes'] })
      toast.success('Cliente excluído')
      setDeleteDialog(null)
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, CPF ou telefone..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={cidadeFilter} onValueChange={setCidadeFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Cidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as cidades</SelectItem>
            {cidades.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="ativo">Ativo</SelectItem>
            <SelectItem value="inadimplente">Inadimplente</SelectItem>
            <SelectItem value="inativo">Inativo</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={openNew} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />Novo Cliente
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} cliente(s) encontrado(s)</p>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum cliente encontrado.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <Card key={c.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{c.nome}</p>
                      {c.codigo && (
                        <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{c.codigo}</span>
                      )}
                      <Badge variant={statusConfig[c.status].variant} className="text-xs shrink-0">
                        {statusConfig[c.status].label}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {c.cidade} · {formatPhone(c.telefone)} · {formatCPFCNPJ(c.cpfCnpj)}
                    </p>
                    {getSaldoDevedor(c.id) > 0 && (
                      <p className="text-xs font-medium text-destructive">
                        {formatCurrency(getSaldoDevedor(c.id))} em aberto
                      </p>
                    )}
                    {c.motivoInadimplencia && (
                      <p className="text-xs text-destructive mt-0.5 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />{c.motivoInadimplencia}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8"
                      onClick={() => window.open(buildWhatsAppUrl(c.telefone, `Olá ${c.nome}!`), '_blank')}>
                      <MessageCircle className="h-4 w-4 text-green-600" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => router.push(`/clientes/${c.id}`)}>
                          <Eye className="mr-2 h-4 w-4" />Ver histórico
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(c)}>
                          <Pencil className="mr-2 h-4 w-4" />Editar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog(c)}>
                          <Trash2 className="mr-2 h-4 w-4" />Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCliente ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Nome */}
            <div className="space-y-1">
              <Label>Nome completo *</Label>
              <Input
                placeholder="João da Silva"
                {...register('nome')}
                onChange={(e) => setValue('nome', onlyLetters(e.target.value))}
              />
              {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* CPF/CNPJ */}
              <div className="space-y-1">
                <Label>CPF / CNPJ *</Label>
                <Input
                  placeholder="000.000.000-00"
                  {...register('cpfCnpj')}
                  onChange={(e) => setValue('cpfCnpj', maskCPFCNPJ(e.target.value))}
                  maxLength={18}
                />
                {errors.cpfCnpj && <p className="text-xs text-destructive">{errors.cpfCnpj.message}</p>}
              </div>

              {/* Telefone */}
              <div className="space-y-1">
                <Label>Telefone (WhatsApp) *</Label>
                <Input
                  placeholder="(11) 99999-9999"
                  {...register('telefone')}
                  onChange={(e) => setValue('telefone', maskPhone(e.target.value))}
                  maxLength={15}
                />
                {errors.telefone && <p className="text-xs text-destructive">{errors.telefone.message}</p>}
              </div>

              {/* Cidade */}
              <div className="space-y-1">
                <Label>Cidade *</Label>
                <Input
                  placeholder="São Paulo"
                  {...register('cidade')}
                  onChange={(e) => setValue('cidade', onlyLetters(e.target.value))}
                />
                {errors.cidade && <p className="text-xs text-destructive">{errors.cidade.message}</p>}
              </div>

              {/* Status */}
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

            {/* Endereço */}
            <div className="space-y-1">
              <Label>Endereço completo *</Label>
              <Input placeholder="Rua das Flores, 123 - Bairro" {...register('endereco')} />
              {errors.endereco && <p className="text-xs text-destructive">{errors.endereco.message}</p>}
            </div>

            {/* Motivo inadimplência */}
            {statusWatch === 'inadimplente' && (
              <div className="space-y-1">
                <Label>Motivo da inadimplência</Label>
                <Input placeholder="Ex: Parcelas em atraso desde jan/2025" {...register('motivoInadimplencia')} />
              </div>
            )}

            {/* Observações */}
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea placeholder="Informações adicionais..." rows={3} {...register('observacoes')} />
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingCliente ? 'Salvar' : 'Cadastrar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir cliente?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir <strong>{deleteDialog?.nome}</strong>? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteDialog && handleDelete(deleteDialog)}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

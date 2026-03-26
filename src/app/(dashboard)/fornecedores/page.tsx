'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy, query as fsQuery,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { fetchCacheFirst } from '@/lib/firestore-cache'
import type { Fornecedor } from '@/types'
import { maskPhone, onlyLetters } from '@/lib/utils'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus, Search, MoreVertical, Pencil, Trash2, Phone, Loader2 } from 'lucide-react'

const fornecedorSchema = z.object({
  nome: z.string().min(2, 'Nome obrigatório'),
  contato: z.string().optional(),
  telefone: z.string().refine((v) => !v || v.replace(/\D/g, '').length >= 10, 'Telefone inválido').optional(),
  cidade: z.string().refine((v) => !v || /^[a-zA-ZÀ-ÿ\s]+$/.test(v), 'Apenas letras').optional(),
  observacoes: z.string().optional(),
})
type FornecedorForm = z.infer<typeof fornecedorSchema>

async function fetchFornecedores(): Promise<Fornecedor[]> {
  return fetchCacheFirst(
    fsQuery(collection(db, 'fornecedores'), orderBy('nome')),
    (id, data) => ({ id, ...data } as Fornecedor),
  )
}

export default function FornecedoresPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingFornecedor, setEditingFornecedor] = useState<Fornecedor | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<Fornecedor | null>(null)

  const { data: fornecedores = [], isLoading } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: fetchFornecedores,
  })

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => fetchCacheFirst(
      collection(db, 'produtos') as Parameters<typeof fetchCacheFirst>[0],
      (_id, data) => data,
    ),
  })

  const filtered = fornecedores.filter((f) =>
    f.nome.toLowerCase().includes(search.toLowerCase()) ||
    (f.cidade ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FornecedorForm>({
    resolver: zodResolver(fornecedorSchema),
  })

  function openNew() {
    setEditingFornecedor(null)
    reset({})
    setDialogOpen(true)
  }

  function openEdit(f: Fornecedor) {
    setEditingFornecedor(f)
    reset({ nome: f.nome, contato: f.contato, telefone: f.telefone, cidade: f.cidade, observacoes: f.observacoes })
    setDialogOpen(true)
  }

  async function onSubmit(data: FornecedorForm) {
    setSaving(true)
    try {
      if (editingFornecedor) {
        await updateDoc(doc(db, 'fornecedores', editingFornecedor.id), { ...data, updatedAt: serverTimestamp() })
        toast.success('Fornecedor atualizado!')
      } else {
        await addDoc(collection(db, 'fornecedores'), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        toast.success('Fornecedor cadastrado!')
      }
      qc.invalidateQueries({ queryKey: ['fornecedores'] })
      setDialogOpen(false)
    } catch {
      toast.error('Erro ao salvar fornecedor')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(f: Fornecedor) {
    try {
      await deleteDoc(doc(db, 'fornecedores', f.id))
      qc.invalidateQueries({ queryKey: ['fornecedores'] })
      toast.success('Fornecedor excluído')
      setDeleteDialog(null)
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  const produtosPorFornecedor = (id: string) =>
    produtos.filter((p: { fornecedorId?: string }) => p.fornecedorId === id).length

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar fornecedor..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button onClick={openNew} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Novo Fornecedor
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum fornecedor encontrado.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((f) => (
            <Card key={f.id}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{f.nome}</p>
                    <p className="text-sm text-muted-foreground">
                      {f.cidade && `${f.cidade} · `}{f.contato && `${f.contato} · `}
                      {produtosPorFornecedor(f.id)} produto(s)
                    </p>
                    {f.telefone && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />{f.telefone}
                      </p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(f)}>
                        <Pencil className="mr-2 h-4 w-4" />Editar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog(f)}>
                        <Trash2 className="mr-2 h-4 w-4" />Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFornecedor ? 'Editar Fornecedor' : 'Novo Fornecedor'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input placeholder="Nome da empresa/pessoa" {...register('nome')} />
              {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Contato</Label>
                <Input
                  placeholder="Nome do contato"
                  {...register('contato')}
                  onChange={(e) => setValue('contato', onlyLetters(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label>Telefone</Label>
                <Input
                  placeholder="(11) 99999-9999"
                  {...register('telefone')}
                  onChange={(e) => setValue('telefone', maskPhone(e.target.value))}
                  maxLength={15}
                />
                {errors.telefone && <p className="text-xs text-destructive">{errors.telefone.message}</p>}
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Cidade</Label>
                <Input
                  placeholder="São Paulo"
                  {...register('cidade')}
                  onChange={(e) => setValue('cidade', onlyLetters(e.target.value))}
                />
                {errors.cidade && <p className="text-xs text-destructive">{errors.cidade.message}</p>}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea rows={3} {...register('observacoes')} />
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingFornecedor ? 'Salvar' : 'Cadastrar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir fornecedor?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza que deseja excluir <strong>{deleteDialog?.nome}</strong>?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteDialog && handleDelete(deleteDialog)}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

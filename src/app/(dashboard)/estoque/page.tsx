'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy, query as fsQuery,
} from 'firebase/firestore'
import { fetchCacheFirst } from '@/lib/firestore-cache'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import type { Produto, CategoriaProduto, Tamanho } from '@/types'
import { formatCurrency, generateProductCode, CATEGORY_PREFIXES } from '@/lib/utils'
import { useForm, Controller, type Resolver } from 'react-hook-form'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  Plus, Search, MoreVertical, Pencil, Trash2, Package,
  Loader2, AlertTriangle, PlusCircle, LayoutGrid, List,
} from 'lucide-react'
import Image from 'next/image'
import { BarcodeScanner } from '@/components/shared/barcode-scanner'

const TAMANHOS: Tamanho[] = ['PP', 'P', 'M', 'G', 'GG', 'XGG']
const CATEGORIAS: CategoriaProduto[] = ['camiseta', 'calca', 'vestido', 'saia', 'blusa', 'short', 'jaqueta', 'conjunto', 'outro']

const estoqueSchema = z.object({
  PP: z.coerce.number().min(0).default(0),
  P:  z.coerce.number().min(0).default(0),
  M:  z.coerce.number().min(0).default(0),
  G:  z.coerce.number().min(0).default(0),
  GG: z.coerce.number().min(0).default(0),
  XGG: z.coerce.number().min(0).default(0),
})

const produtoSchema = z.object({
  nome: z.string().min(2, 'Nome obrigatório'),
  descricao: z.string().optional(),
  categoria: z.enum(['camiseta', 'calca', 'vestido', 'saia', 'blusa', 'short', 'jaqueta', 'conjunto', 'outro']),
  precoCusto: z.coerce.number().min(0),
  precoVenda: z.coerce.number().min(0.01, 'Preço de venda obrigatório'),
  codigoBarras: z.string().optional(),
  fornecedorId: z.string().optional(),
  fornecedorNome: z.string().optional(),
  estoque: estoqueSchema,
})

type ProdutoForm = z.infer<typeof produtoSchema>

async function fetchProdutos(): Promise<Produto[]> {
  return fetchCacheFirst(
    fsQuery(collection(db, 'produtos'), orderBy('codigo')),
    (id, data) => ({ id, ...data } as Produto),
  )
}

type ViewMode = 'cards' | 'lista'

export default function EstoquePage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('todas')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<Produto | null>(null)
  const [entradaDialog, setEntradaDialog] = useState<Produto | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  const { data: produtos = [], isLoading } = useQuery({ queryKey: ['produtos'], queryFn: fetchProdutos })

  const filtered = produtos.filter((p) => {
    const matchSearch =
      p.nome.toLowerCase().includes(search.toLowerCase()) ||
      p.codigo?.toLowerCase().includes(search.toLowerCase()) ||
      (p.codigoBarras ?? '').includes(search)
    const matchCat = catFilter === 'todas' || p.categoria === catFilter
    return matchSearch && matchCat
  })

  const { register, handleSubmit, reset, control, setValue, formState: { errors } } = useForm<ProdutoForm>({
    // Cast necessário: zod v4 + @hookform/resolvers v5 — z.coerce infere como `unknown` no output
    resolver: zodResolver(produtoSchema) as unknown as Resolver<ProdutoForm>,
    defaultValues: { categoria: 'camiseta', precoCusto: 0, precoVenda: 0, estoque: { PP: 0, P: 0, M: 0, G: 0, GG: 0, XGG: 0 } },
  })

  function openNew() {
    setEditingProduto(null)
    setPhotoFile(null)
    reset({ categoria: 'camiseta', precoCusto: 0, precoVenda: 0, estoque: { PP: 0, P: 0, M: 0, G: 0, GG: 0, XGG: 0 } })
    setDialogOpen(true)
  }

  function openEdit(p: Produto) {
    setEditingProduto(p)
    setPhotoFile(null)
    reset({
      nome: p.nome, descricao: p.descricao ?? '', categoria: p.categoria,
      precoCusto: p.precoCusto, precoVenda: p.precoVenda,
      codigoBarras: p.codigoBarras ?? '',
      fornecedorId: p.fornecedorId ?? '', fornecedorNome: p.fornecedorNome ?? '',
      estoque: p.estoque,
    })
    setDialogOpen(true)
  }

  async function onSubmit(data: ProdutoForm) {
    setSaving(true)
    try {
      let fotoUrl = editingProduto?.fotoUrl ?? ''
      if (photoFile) {
        const fileRef = ref(storage, `produtos/${Date.now()}_${photoFile.name}`)
        await uploadBytes(fileRef, photoFile)
        fotoUrl = await getDownloadURL(fileRef)
      }

      if (editingProduto) {
        await updateDoc(doc(db, 'produtos', editingProduto.id), {
          ...data, fotoUrl, updatedAt: serverTimestamp(),
        })
        toast.success('Produto atualizado!')
      } else {
        const existingCodes = produtos.map((p) => p.codigo ?? '')
        const codigo = generateProductCode(data.categoria, existingCodes)
        await addDoc(collection(db, 'produtos'), {
          ...data, fotoUrl, codigo, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
        toast.success(`Produto cadastrado! Código: ${codigo}`)
      }
      qc.invalidateQueries({ queryKey: ['produtos'] })
      setDialogOpen(false)
    } catch {
      toast.error('Erro ao salvar produto')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(p: Produto) {
    try {
      await deleteDoc(doc(db, 'produtos', p.id))
      qc.invalidateQueries({ queryKey: ['produtos'] })
      toast.success('Produto excluído')
      setDeleteDialog(null)
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  const totalPecas = (p: Produto) => Object.values(p.estoque).reduce((a, b) => a + b, 0)
  const hasLowStock = (p: Produto) => Object.values(p.estoque).some((q) => q > 0 && q < 5)

  const ActionMenu = ({ p }: { p: Produto }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setEntradaDialog(p)}>
          <PlusCircle className="mr-2 h-4 w-4" />Entrada de estoque
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openEdit(p)}>
          <Pencil className="mr-2 h-4 w-4" />Editar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog(p)}>
          <Trash2 className="mr-2 h-4 w-4" />Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou código..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            {CATEGORIAS.map((c) => (
              <SelectItem key={c} value={c} className="capitalize">
                {CATEGORY_PREFIXES[c]} — {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Toggle de visão */}
        <div className="flex border rounded-lg overflow-hidden shrink-0">
          <Button
            variant={viewMode === 'cards' ? 'default' : 'ghost'}
            size="sm"
            className="rounded-none h-9 px-3"
            onClick={() => setViewMode('cards')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'lista' ? 'default' : 'ghost'}
            size="sm"
            className="rounded-none h-9 px-3 border-l"
            onClick={() => setViewMode('lista')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>

        <Button onClick={openNew} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />Novo Produto
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} produto(s)</p>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum produto encontrado.</CardContent></Card>
      ) : viewMode === 'cards' ? (
        // ── VISÃO CARDS ──────────────────────────────────────────────────────
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <Card key={p.id} className={hasLowStock(p) ? 'border-orange-300 dark:border-orange-700' : ''}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {p.fotoUrl ? (
                      <Image src={p.fotoUrl} alt={p.nome} width={48} height={48} className="rounded-lg object-cover shrink-0 border" />
                    ) : (
                      <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center shrink-0 border">
                        <Package className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold truncate leading-tight">{p.nome}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                          {p.codigo ?? '—'}
                        </Badge>
                        <span className="text-xs text-muted-foreground capitalize">{p.categoria}</span>
                      </div>
                    </div>
                  </div>
                  <ActionMenu p={p} />
                </div>

                {/* Preços */}
                <div className="flex gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Custo</p>
                    <p>{formatCurrency(p.precoCusto)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Venda</p>
                    <p className="font-semibold text-green-600 dark:text-green-400">{formatCurrency(p.precoVenda)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p>{totalPecas(p)} pç</p>
                  </div>
                </div>

                {/* Estoque por tamanho */}
                <div className="flex flex-wrap gap-1">
                  {TAMANHOS.map((t) => {
                    const qty = p.estoque[t] ?? 0
                    return (
                      <span
                        key={t}
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border
                          ${qty === 0 ? 'opacity-30 border-border text-muted-foreground' :
                            qty < 5 ? 'border-orange-400 text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950' :
                            'border-border bg-muted text-foreground'}`}
                      >
                        {t}: {qty}
                      </span>
                    )
                  })}
                </div>

                {hasLowStock(p) && (
                  <p className="text-xs text-orange-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />Estoque baixo em alguns tamanhos
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        // ── VISÃO LISTA ───────────────────────────────────────────────────────
        <div className="border rounded-lg overflow-hidden">
          {/* Header */}
          <div className="hidden md:grid grid-cols-12 gap-2 px-3 py-2 bg-muted text-xs font-medium text-muted-foreground border-b">
            <div className="col-span-1">Foto</div>
            <div className="col-span-2">Código</div>
            <div className="col-span-3">Nome</div>
            <div className="col-span-1">Cat.</div>
            <div className="col-span-3">Estoque (PP/P/M/G/GG/XGG)</div>
            <div className="col-span-1">Venda</div>
            <div className="col-span-1"></div>
          </div>

          <div className="divide-y">
            {filtered.map((p) => (
              <div key={p.id} className={`flex md:grid md:grid-cols-12 gap-2 px-3 py-2 items-center hover:bg-muted/40 transition-colors ${hasLowStock(p) ? 'bg-orange-50/50 dark:bg-orange-950/20' : ''}`}>
                {/* Foto */}
                <div className="col-span-1 shrink-0">
                  {p.fotoUrl ? (
                    <Image src={p.fotoUrl} alt={p.nome} width={36} height={36} className="rounded object-cover border" />
                  ) : (
                    <div className="w-9 h-9 bg-muted rounded border flex items-center justify-center">
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Info principal (mobile: tudo junto) */}
                <div className="flex-1 min-w-0 md:contents">
                  <div className="col-span-2">
                    <span className="font-mono text-xs font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {p.codigo ?? '—'}
                    </span>
                  </div>
                  <div className="col-span-3 md:hidden lg:block truncate font-medium text-sm">{p.nome}</div>
                  <div className="hidden md:block col-span-3 truncate font-medium text-sm">{p.nome}</div>
                  <div className="col-span-1 hidden md:block">
                    <span className="text-xs capitalize text-muted-foreground">{p.categoria}</span>
                  </div>

                  {/* Estoque */}
                  <div className="col-span-3 hidden md:flex gap-1 flex-wrap">
                    {TAMANHOS.map((t) => {
                      const qty = p.estoque[t] ?? 0
                      return (
                        <span key={t} className={`text-xs rounded px-1 py-0.5 border ${
                          qty === 0 ? 'opacity-30' : qty < 5 ? 'text-orange-600 border-orange-300' : 'text-foreground border-border'
                        }`}>
                          {qty}
                        </span>
                      )
                    })}
                  </div>

                  {/* Mobile: estoque resumido */}
                  <div className="md:hidden text-xs text-muted-foreground">
                    {TAMANHOS.filter((t) => (p.estoque[t] ?? 0) > 0)
                      .map((t) => `${t}:${p.estoque[t]}`)
                      .join(' · ') || 'Sem estoque'}
                  </div>

                  <div className="col-span-1 hidden md:block text-sm font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(p.precoVenda)}
                  </div>
                </div>

                <div className="col-span-1 shrink-0">
                  {hasLowStock(p) && <AlertTriangle className="h-3.5 w-3.5 text-orange-500 mr-1 inline" />}
                  <ActionMenu p={p} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProduto
                ? `Editar Produto — ${editingProduto.codigo ?? ''}`
                : 'Novo Produto'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit as Parameters<typeof handleSubmit>[0])} className="space-y-4">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input placeholder="Camiseta Básica" {...register('nome')} />
              {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Descrição</Label>
              <Textarea placeholder="Descrição opcional..." rows={2} {...register('descricao')} />
            </div>

            <div className="space-y-1">
              <Label>Código de Barras</Label>
              <div className="flex gap-2">
                <Input placeholder="Ex: 7891234567890" {...register('codigoBarras')} className="flex-1" />
                <BarcodeScanner compact onDetected={(code) => setValue('codigoBarras', code)} label="Ler código" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Categoria *</Label>
                <Controller
                  name="categoria"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIAS.map((c) => (
                          <SelectItem key={c} value={c}>
                            <span className="font-mono text-xs text-muted-foreground mr-2">{CATEGORY_PREFIXES[c]}</span>
                            <span className="capitalize">{c}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1">
                <Label>Foto (opcional)</Label>
                <Input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
              </div>

              <div className="space-y-1">
                <Label>Preço de Custo (R$) *</Label>
                <Input type="number" step="0.01" min="0" placeholder="0,00"
                  {...register('precoCusto')}
                  onKeyPress={(e) => { if (!/[\d.,]/.test(e.key)) e.preventDefault() }} />
                {errors.precoCusto && <p className="text-xs text-destructive">{errors.precoCusto.message}</p>}
              </div>

              <div className="space-y-1">
                <Label>Preço de Venda (R$) *</Label>
                <Input type="number" step="0.01" min="0.01" placeholder="0,00"
                  {...register('precoVenda')}
                  onKeyPress={(e) => { if (!/[\d.,]/.test(e.key)) e.preventDefault() }} />
                {errors.precoVenda && <p className="text-xs text-destructive">{errors.precoVenda.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Estoque por Tamanho</Label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {TAMANHOS.map((t) => (
                  <div key={t} className="space-y-1">
                    <Label className="text-xs font-semibold text-center block">{t}</Label>
                    <Input
                      type="number" min="0" className="text-center px-1"
                      {...register(`estoque.${t}` as `estoque.${Tamanho}`)}
                      onKeyPress={(e) => { if (!/\d/.test(e.key)) e.preventDefault() }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {!editingProduto && (
              <p className="text-xs text-muted-foreground bg-muted px-3 py-2 rounded-lg">
                O código interno será gerado automaticamente baseado na categoria selecionada.
              </p>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingProduto ? 'Salvar' : 'Cadastrar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {entradaDialog && (
        <EntradaEstoqueDialog
          produto={entradaDialog}
          onClose={() => setEntradaDialog(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['produtos'] }); setEntradaDialog(null) }}
        />
      )}

      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir produto?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir <strong>{deleteDialog?.nome}</strong>{deleteDialog?.codigo ? ` (${deleteDialog.codigo})` : ''}?
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

function EntradaEstoqueDialog({ produto, onClose, onSaved }: { produto: Produto; onClose: () => void; onSaved: () => void }) {
  const [qtds, setQtds] = useState<Record<Tamanho, number>>({ PP: 0, P: 0, M: 0, G: 0, GG: 0, XGG: 0 })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const novoEstoque = { ...produto.estoque }
      for (const t of TAMANHOS) {
        novoEstoque[t] = (novoEstoque[t] ?? 0) + (qtds[t] ?? 0)
      }
      await updateDoc(doc(db, 'produtos', produto.id), { estoque: novoEstoque, updatedAt: serverTimestamp() })
      for (const t of TAMANHOS) {
        if (qtds[t] > 0) {
          await addDoc(collection(db, 'movimentacoes'), {
            produtoId: produto.id, produtoNome: produto.nome,
            tipo: 'entrada', tamanho: t, quantidade: qtds[t],
            motivo: 'Entrada manual', createdAt: serverTimestamp(),
          })
        }
      }
      toast.success('Estoque atualizado!')
      onSaved()
    } catch {
      toast.error('Erro ao atualizar estoque')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Entrada de Estoque
            <span className="ml-2 font-mono text-sm text-muted-foreground">{produto.codigo}</span>
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{produto.nome}</p>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          {TAMANHOS.map((t) => (
            <div key={t} className="space-y-1">
              <Label className="text-xs">{t} <span className="text-muted-foreground">(atual: {produto.estoque[t] ?? 0})</span></Label>
              <Input
                type="number" min="0" className="text-center"
                value={qtds[t]}
                onChange={(e) => setQtds((prev) => ({ ...prev, [t]: Number(e.target.value) }))}
                onKeyPress={(e) => { if (!/\d/.test(e.key)) e.preventDefault() }}
              />
            </div>
          ))}
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar Entrada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

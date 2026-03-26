'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, collection, query, where, getDocs, writeBatch, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Venda, Parcela, Produto } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ArrowLeft, FileDown, XCircle, Loader2 } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import { toast } from 'sonner'

const fpLabel: Record<string, string> = {
  dinheiro: 'Dinheiro', pix: 'PIX', cartao: 'Cartão', promissoria: 'Nota Promissória'
}

const statusMap: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  paga: { label: 'Paga', variant: 'default' },
  pendente: { label: 'Pendente', variant: 'secondary' },
  parcialmente_paga: { label: 'Parcial', variant: 'outline' },
  atrasada: { label: 'Atrasada', variant: 'destructive' },
  cancelada: { label: 'Cancelada', variant: 'outline' },
}

async function fetchVendaDetalhes(id: string) {
  const [vendaSnap, parcelasSnap] = await Promise.all([
    getDoc(doc(db, 'vendas', id)),
    getDocs(query(collection(db, 'parcelas'), where('vendaId', '==', id))),
  ])
  const venda = vendaSnap.exists() ? ({ id: vendaSnap.id, ...vendaSnap.data() } as Venda) : null
  const parcelas = parcelasSnap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Parcela))
    .sort((a, b) => a.numero - b.numero)
  return { venda, parcelas }
}

async function fetchProdutos(): Promise<Produto[]> {
  const snap = await getDocs(collection(db, 'produtos'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Produto))
}

export default function VendaDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const [cancelDialog, setCancelDialog] = useState(false)
  const [canceling, setCanceling] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['venda', id],
    queryFn: () => fetchVendaDetalhes(id),
  })

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: fetchProdutos,
  })

  async function handleCancelarVenda() {
    if (!data?.venda) return
    setCanceling(true)
    try {
      const { venda, parcelas } = data
      const batch = writeBatch(db)

      // Cancel venda
      batch.update(doc(db, 'vendas', venda.id), {
        status: 'cancelada',
        updatedAt: serverTimestamp(),
      })

      // Cancel all parcelas
      for (const p of parcelas ?? []) {
        if (p.status !== 'paga') {
          batch.update(doc(db, 'parcelas', p.id), {
            status: 'cancelada',
            updatedAt: serverTimestamp(),
          })
        }
      }

      // Restore stock for each item
      for (const item of venda.itens) {
        const produto = produtos.find((p) => p.id === item.produtoId)
        if (produto) {
          const novoEstoque = { ...produto.estoque }
          novoEstoque[item.tamanho] = (novoEstoque[item.tamanho] ?? 0) + item.quantidade
          batch.update(doc(db, 'produtos', item.produtoId), {
            estoque: novoEstoque,
            updatedAt: serverTimestamp(),
          })
          // Register stock entry movement
          const movRef = doc(collection(db, 'movimentacoes'))
          batch.set(movRef, {
            produtoId: item.produtoId,
            produtoNome: item.produtoNome,
            tipo: 'entrada',
            tamanho: item.tamanho,
            quantidade: item.quantidade,
            motivo: `Cancelamento da venda`,
            vendaId: venda.id,
            createdAt: serverTimestamp(),
          })
        }
      }

      await batch.commit()
      qc.invalidateQueries({ queryKey: ['venda', id] })
      qc.invalidateQueries({ queryKey: ['vendas'] })
      qc.invalidateQueries({ queryKey: ['produtos'] })
      qc.invalidateQueries({ queryKey: ['parcelas'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Venda cancelada. Estoque restaurado.')
      setCancelDialog(false)
    } catch (err) {
      toast.error('Erro ao cancelar venda')
      console.error(err)
    } finally {
      setCanceling(false)
    }
  }

  async function handleExportPDF() {
    if (!data?.venda) return
    const { venda, parcelas } = data

    const { default: jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

    const pageW = pdf.internal.pageSize.getWidth()
    let y = 20

    // Header
    pdf.setFontSize(18)
    pdf.setFont('helvetica', 'bold')
    pdf.text('RECIBO DE VENDA', pageW / 2, y, { align: 'center' })
    y += 8

    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(100)
    pdf.text(`Data: ${formatDate(venda.createdAt instanceof Timestamp ? venda.createdAt.toDate() : new Date(venda.createdAt))}`, pageW / 2, y, { align: 'center' })
    y += 12

    // Divider
    pdf.setDrawColor(200)
    pdf.line(15, y, pageW - 15, y)
    y += 8

    // Client info
    pdf.setTextColor(0)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.text('CLIENTE', 15, y)
    y += 6
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.text(`${venda.clienteNome}  —  ${venda.clienteCidade}`, 15, y)
    y += 10

    // Divider
    pdf.setDrawColor(200)
    pdf.line(15, y, pageW - 15, y)
    y += 8

    // Items table header
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.text('PRODUTO', 15, y)
    pdf.text('TAM', 110, y)
    pdf.text('QTD', 125, y)
    pdf.text('UNIT.', 145, y)
    pdf.text('SUBTOTAL', 170, y)
    y += 5
    pdf.line(15, y, pageW - 15, y)
    y += 5

    pdf.setFont('helvetica', 'normal')
    for (const item of venda.itens) {
      if (y > 260) { pdf.addPage(); y = 20 }
      pdf.text(item.produtoNome.substring(0, 38), 15, y)
      pdf.text(item.tamanho, 110, y)
      pdf.text(String(item.quantidade), 125, y)
      pdf.text(formatCurrency(item.precoUnitario), 140, y)
      pdf.text(formatCurrency(item.subtotal), 168, y)
      y += 6
    }

    y += 2
    pdf.line(15, y, pageW - 15, y)
    y += 6
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12)
    pdf.text('TOTAL', 145, y)
    pdf.text(formatCurrency(venda.total), 168, y)
    y += 10

    // Payment info
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.text(`Forma de pagamento: ${fpLabel[venda.formaPagamento] ?? venda.formaPagamento}`, 15, y)
    y += 6

    // Parcelas
    if (parcelas && parcelas.length > 0) {
      y += 4
      pdf.setDrawColor(200)
      pdf.line(15, y, pageW - 15, y)
      y += 8

      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(11)
      pdf.text('PARCELAS', 15, y)
      y += 6

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      for (const p of parcelas) {
        if (y > 265) { pdf.addPage(); y = 20 }
        const dueDate = p.dataVencimento instanceof Timestamp ? p.dataVencimento.toDate() : new Date(p.dataVencimento)
        const label = p.numero === 0 ? 'Entrada' : `Parcela ${p.numero}/${p.totalParcelas}`
        pdf.text(`${label}  —  Venc: ${formatDate(dueDate)}`, 15, y)
        pdf.text(formatCurrency(p.valor), 168, y)
        y += 6
      }
    }

    // Footer
    y += 10
    pdf.setDrawColor(200)
    pdf.line(15, y, pageW - 15, y)
    y += 8
    pdf.setTextColor(150)
    pdf.setFontSize(8)
    pdf.text('Documento gerado pelo sistema de gestão de roupas', pageW / 2, y, { align: 'center' })

    pdf.save(`recibo-venda-${venda.clienteNome.replace(/\s+/g, '-')}.pdf`)
  }

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 rounded-xl" /></div>
  }

  const { venda, parcelas } = data ?? {}
  if (!venda) return <p className="text-muted-foreground">Venda não encontrada.</p>

  const s = statusMap[venda.status] ?? { label: venda.status, variant: 'secondary' as const }
  const isCanceled = venda.status === 'cancelada'

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.back()} className="-ml-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportPDF}>
            <FileDown className="mr-2 h-4 w-4" />
            PDF
          </Button>
          {!isCanceled && (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setCancelDialog(true)}>
              <XCircle className="mr-2 h-4 w-4" />
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {/* Header */}
      <Card className={isCanceled ? 'opacity-60' : ''}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-xl">{venda.clienteNome}</CardTitle>
              <p className="text-sm text-muted-foreground">{venda.clienteCidade}</p>
            </div>
            <Badge variant={s.variant}>{s.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Data:</span> {formatDate(venda.createdAt instanceof Timestamp ? venda.createdAt.toDate() : new Date(venda.createdAt))}</p>
          <p><span className="text-muted-foreground">Pagamento:</span> {fpLabel[venda.formaPagamento]}{venda.formaPagamento === 'promissoria' ? ` — ${venda.numeroParcelas}x` : ''}</p>
          {venda.observacoes && <p><span className="text-muted-foreground">Obs:</span> {venda.observacoes}</p>}
        </CardContent>
      </Card>

      {/* Itens */}
      <Card>
        <CardHeader><CardTitle className="text-base">Itens da Venda</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {venda.itens.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                <div>
                  <p className="font-medium">{item.produtoNome}</p>
                  <p className="text-xs text-muted-foreground">{item.tamanho} × {item.quantidade} — {formatCurrency(item.precoUnitario)}/un</p>
                </div>
                <p className="font-semibold">{formatCurrency(item.subtotal)}</p>
              </div>
            ))}
            <div className="flex justify-between font-bold pt-2 text-lg">
              <span>Total</span>
              <span>{formatCurrency(venda.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Parcelas */}
      {parcelas && parcelas.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Parcelas</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {parcelas.map((p) => {
                const ps = statusMap[p.status] ?? { label: p.status, variant: 'secondary' as const }
                const dueDate = p.dataVencimento instanceof Timestamp ? p.dataVencimento.toDate() : new Date(p.dataVencimento)
                return (
                  <div key={p.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                    <div>
                      <p className="font-medium">{p.numero === 0 ? 'Entrada' : `Parcela ${p.numero}/${p.totalParcelas}`}</p>
                      <p className="text-xs text-muted-foreground">Vence: {formatDate(dueDate)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatCurrency(p.valor)}</p>
                      {p.valorPago > 0 && p.valorPago < p.valor && (
                        <p className="text-xs text-muted-foreground">Pago: {formatCurrency(p.valorPago)}</p>
                      )}
                      <Badge variant={ps.variant} className="text-xs">{ps.label}</Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancel Dialog */}
      <Dialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Cancelar Venda
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Tem certeza que deseja cancelar esta venda?</p>
            <ul className="list-disc list-inside space-y-1">
              <li>O estoque dos produtos será <strong className="text-foreground">restaurado</strong></li>
              <li>As parcelas pendentes serão <strong className="text-foreground">canceladas</strong></li>
              <li>Parcelas já pagas <strong className="text-foreground">não são revertidas</strong></li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(false)}>Voltar</Button>
            <Button variant="destructive" onClick={handleCancelarVenda} disabled={canceling}>
              {canceling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar Cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

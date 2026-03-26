import { Timestamp } from 'firebase/firestore'

// ─── AUTH ────────────────────────────────────────────────────────────────────
export interface AppUser {
  uid: string
  email: string
  name: string
}

// ─── CLIENTE ─────────────────────────────────────────────────────────────────
export type ClienteStatus = 'ativo' | 'inadimplente' | 'inativo'

export interface Cliente {
  id: string
  codigo: string
  nome: string
  cpfCnpj: string
  telefone: string
  cidade: string
  endereco: string
  observacoes?: string
  status: ClienteStatus
  motivoInadimplencia?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ─── FORNECEDOR ──────────────────────────────────────────────────────────────
export interface Fornecedor {
  id: string
  nome: string
  contato?: string
  telefone?: string
  cidade?: string
  observacoes?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ─── PRODUTO / ESTOQUE ───────────────────────────────────────────────────────
export type CategoriaProduto =
  | 'camiseta'
  | 'calca'
  | 'vestido'
  | 'saia'
  | 'blusa'
  | 'short'
  | 'jaqueta'
  | 'conjunto'
  | 'outro'

export type Tamanho = 'PP' | 'P' | 'M' | 'G' | 'GG' | 'XGG'

export type EstoquePorTamanho = Record<Tamanho, number>

export interface Produto {
  id: string
  codigo: string
  nome: string
  descricao?: string
  categoria: CategoriaProduto
  precoCusto: number
  precoVenda: number
  estoque: EstoquePorTamanho
  fotoUrl?: string
  fornecedorId?: string
  fornecedorNome?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface MovimentacaoEstoque {
  id: string
  produtoId: string
  produtoNome: string
  tipo: 'entrada' | 'saida'
  tamanho: Tamanho
  quantidade: number
  motivo: string
  vendaId?: string
  createdAt: Timestamp
}

// ─── VENDA ───────────────────────────────────────────────────────────────────
export type FormaPagamento = 'dinheiro' | 'pix' | 'cartao' | 'promissoria'
export type StatusVenda = 'paga' | 'parcialmente_paga' | 'pendente' | 'atrasada' | 'cancelada'

export interface ItemVenda {
  produtoId: string
  produtoNome: string
  tamanho: Tamanho
  quantidade: number
  precoUnitario: number
  subtotal: number
}

export interface Venda {
  id: string
  clienteId: string
  clienteNome: string
  clienteCidade: string
  itens: ItemVenda[]
  total: number
  formaPagamento: FormaPagamento
  entrada?: number
  numeroParcelas?: number
  observacoes?: string
  status: StatusVenda
  dataVenda: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ─── PARCELA ─────────────────────────────────────────────────────────────────
export type StatusParcela = 'pendente' | 'paga' | 'atrasada' | 'parcialmente_paga' | 'cancelada'

export interface PagamentoParcela {
  id: string
  valor: number
  dataPagamento: Timestamp
  formaPagamento: FormaPagamento
  observacoes?: string
}

export interface Parcela {
  id: string
  vendaId: string
  clienteId: string
  clienteNome: string
  clienteTelefone: string
  numero: number
  totalParcelas: number
  valor: number
  valorPago: number
  dataVencimento: Timestamp
  status: StatusParcela
  pagamentos: PagamentoParcela[]
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ─── CONFIGURAÇÕES ───────────────────────────────────────────────────────────
export interface Configuracoes {
  nomeVendedor: string
  telefoneVendedor: string
  templateCobranca: string
  templateInadimplente: string
  templateConfirmacaoPagamento: string
  nomeApp?: string
  logoUrl?: string
}

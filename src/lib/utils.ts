import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, isAfter, isBefore, addDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, 'dd/MM/yyyy', { locale: ptBR })
}

export function formatDatetime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

export function formatCPFCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  }
  return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
}

export function isOverdue(dueDate: Date | string): boolean {
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return isBefore(d, today)
}

export function isDueInDays(dueDate: Date | string, days: number): boolean {
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const limit = addDays(today, days)
  return isAfter(d, today) && isBefore(d, limit)
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '')
  const fullNumber = digits.startsWith('55') ? digits : `55${digits}`
  return `https://wa.me/${fullNumber}?text=${encodeURIComponent(message)}`
}

export function generateInstallments(
  total: number,
  count: number,
  firstDueDate: Date,
  downPayment = 0,
  intervalDays = 30
): Array<{ number: number; value: number; dueDate: Date }> {
  const remaining = total - downPayment
  const installmentValue = parseFloat((remaining / count).toFixed(2))
  const installments = []

  for (let i = 0; i < count; i++) {
    const dueDate = addDays(new Date(firstDueDate), i * intervalDays)
    installments.push({
      number: i + 1,
      value: i === count - 1 ? remaining - installmentValue * (count - 1) : installmentValue,
      dueDate,
    })
  }

  return installments
}

// ─── Códigos internos ─────────────────────────────────────────────────────────
export const CATEGORY_PREFIXES: Record<string, string> = {
  camiseta: 'CAM',
  calca:    'CAL',
  vestido:  'VES',
  saia:     'SAI',
  blusa:    'BLU',
  short:    'SHT',
  jaqueta:  'JAQ',
  conjunto: 'CON',
  outro:    'OUT',
}

export function generateProductCode(categoria: string, existingCodes: string[]): string {
  const prefix = CATEGORY_PREFIXES[categoria] ?? 'OUT'
  const sameCat = existingCodes
    .filter((c) => c.startsWith(prefix + '-'))
    .map((c) => parseInt(c.split('-')[1] ?? '0', 10))
    .filter((n) => !isNaN(n))
  const next = sameCat.length > 0 ? Math.max(...sameCat) + 1 : 1
  return `${prefix}-${String(next).padStart(3, '0')}`
}

export function generateClientCode(existingCodes: string[]): string {
  const nums = existingCodes
    .filter((c) => c.startsWith('CLI-'))
    .map((c) => parseInt(c.split('-')[1] ?? '0', 10))
    .filter((n) => !isNaN(n))
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  return `CLI-${String(next).padStart(4, '0')}`
}

// ─── Máscaras de input ────────────────────────────────────────────────────────
export function maskCPFCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return digits.slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d{1,4})$/, '$1-$2')
  }
  return digits
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2')
}

export function maskCurrency(value: string): string {
  const digits = value.replace(/\D/g, '')
  const number = parseInt(digits || '0', 10) / 100
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function onlyLetters(value: string): string {
  return value.replace(/[^a-zA-ZÀ-ÿ\s]/g, '')
}

export function onlyNumbers(value: string): string {
  return value.replace(/\D/g, '')
}

// ─── Validações ───────────────────────────────────────────────────────────────
export function isValidCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i)
  let remainder = (sum * 10) % 11
  if (remainder === 10 || remainder === 11) remainder = 0
  if (remainder !== parseInt(digits[9])) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i)
  remainder = (sum * 10) % 11
  if (remainder === 10 || remainder === 11) remainder = 0
  return remainder === parseInt(digits[10])
}

export function isValidCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false
  const calc = (d: string, n: number) => {
    let sum = 0
    let pos = n - 7
    for (let i = n; i >= 1; i--) {
      sum += parseInt(d[n - i]) * pos--
      if (pos < 2) pos = 9
    }
    return sum % 11 < 2 ? 0 : 11 - (sum % 11)
  }
  return calc(digits, 12) === parseInt(digits[12]) && calc(digits, 13) === parseInt(digits[13])
}

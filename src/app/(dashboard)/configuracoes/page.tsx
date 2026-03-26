'use client'

import { useEffect, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import type { Configuracoes } from '@/types'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save, Upload, X, ShoppingBag } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'

const configSchema = z.object({
  nomeVendedor: z.string().min(2, 'Nome obrigatório'),
  telefoneVendedor: z.string().min(10, 'Telefone obrigatório'),
  templateCobranca: z.string().min(10, 'Template obrigatório'),
  templateInadimplente: z.string().min(10, 'Template obrigatório'),
  templateConfirmacaoPagamento: z.string().min(10, 'Template obrigatório'),
})

const aparenciaSchema = z.object({
  nomeApp: z.string().min(2, 'Nome deve ter ao menos 2 caracteres').max(30, 'Máximo 30 caracteres'),
})

type ConfigForm = z.infer<typeof configSchema>
type AparenciaForm = z.infer<typeof aparenciaSchema>

const defaultTemplates = {
  templateCobranca: `Olá {nome}! 👋\n\nPassando para lembrar sobre a parcela {numero}/{total} no valor de *{valor}* com vencimento em *{vencimento}*.\n\nPor favor, entre em contato para regularizar. Obrigado! 😊`,
  templateInadimplente: `Olá {nome}!\n\nGostaríamos de entrar em contato a respeito do seu débito em aberto conosco no valor de *{valor}*.\n\nPor favor, entre em contato para regularizarmos sua situação.\n\nAguardamos seu retorno! 🙏`,
  templateConfirmacaoPagamento: `Olá {nome}! ✅\n\nConfirmamos o recebimento do pagamento de *{valor}* referente à parcela {numero}/{total}.\n\nObrigado pela confiança! 😊`,
}

export default function ConfiguracoesPage() {
  const qc = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingAparencia, setSavingAparencia] = useState(false)
  const [currentLogoUrl, setCurrentLogoUrl] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ConfigForm>({
    resolver: zodResolver(configSchema),
    defaultValues: { ...defaultTemplates, nomeVendedor: '', telefoneVendedor: '' },
  })

  const aparenciaForm = useForm<AparenciaForm>({
    resolver: zodResolver(aparenciaSchema),
    defaultValues: { nomeApp: 'Minha Loja' },
  })

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'config', 'geral'))
        if (snap.exists()) {
          const data = snap.data() as Configuracoes
          reset(data as ConfigForm)
          aparenciaForm.reset({ nomeApp: data.nomeApp || 'Minha Loja' })
          setCurrentLogoUrl(data.logoUrl ?? null)
        } else {
          reset({ nomeVendedor: '', telefoneVendedor: '', ...defaultTemplates })
        }
      } catch {
        toast.error('Erro ao carregar configurações')
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmitConfig(data: ConfigForm) {
    setSaving(true)
    try {
      const snap = await getDoc(doc(db, 'config', 'geral'))
      const existing = snap.exists() ? snap.data() : {}
      await setDoc(doc(db, 'config', 'geral'), { ...existing, ...data })
      qc.invalidateQueries({ queryKey: ['config'] })
      toast.success('Configurações salvas!')
    } catch {
      toast.error('Erro ao salvar configurações')
    } finally {
      setSaving(false)
    }
  }

  async function onSubmitAparencia(data: AparenciaForm) {
    setSavingAparencia(true)
    try {
      const snap = await getDoc(doc(db, 'config', 'geral'))
      const existing = snap.exists() ? snap.data() : {}
      await setDoc(doc(db, 'config', 'geral'), {
        ...existing,
        nomeApp: data.nomeApp,
        logoUrl: currentLogoUrl ?? existing.logoUrl ?? null,
      })
      qc.invalidateQueries({ queryKey: ['config'] })
      toast.success('Aparência atualizada!')
    } catch {
      toast.error('Erro ao salvar aparência')
    } finally {
      setSavingAparencia(false)
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Imagem deve ter no máximo 2MB')
      return
    }

    setUploadingLogo(true)
    setUploadProgress(0)

    try {
      const storageRef = ref(storage, 'config/logo')
      const uploadTask = uploadBytesResumable(storageRef, file)

      uploadTask.on(
        'state_changed',
        (snap) => {
          setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100))
        },
        () => {
          toast.error('Erro ao fazer upload da logo')
          setUploadingLogo(false)
        },
        async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref)
          setCurrentLogoUrl(url)
          setUploadingLogo(false)
          setUploadProgress(0)
          toast.success('Logo carregada! Clique em Salvar Aparência para confirmar.')
        }
      )
    } catch {
      toast.error('Erro ao fazer upload')
      setUploadingLogo(false)
    }
  }

  async function handleRemoveLogo() {
    setCurrentLogoUrl(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <Tabs defaultValue="geral">
        <TabsList className="mb-6">
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="aparencia">Aparência</TabsTrigger>
        </TabsList>

        {/* ─── Aba Geral ─────────────────────────────────────────────────── */}
        <TabsContent value="geral">
          <form onSubmit={handleSubmit(onSubmitConfig)} className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dados do Vendedor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label>Nome *</Label>
                  <Input placeholder="Seu nome completo" {...register('nomeVendedor')} />
                  {errors.nomeVendedor && <p className="text-xs text-destructive">{errors.nomeVendedor.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Telefone / WhatsApp *</Label>
                  <Input placeholder="(11) 99999-9999" {...register('telefoneVendedor')} />
                  {errors.telefoneVendedor && <p className="text-xs text-destructive">{errors.telefoneVendedor.message}</p>}
                </div>
              </CardContent>
            </Card>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar
            </Button>
          </form>
        </TabsContent>

        {/* ─── Aba WhatsApp ──────────────────────────────────────────────── */}
        <TabsContent value="whatsapp">
          <form onSubmit={handleSubmit(onSubmitConfig)} className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Templates de Mensagem</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Variáveis disponíveis: {'{nome}'}, {'{valor}'}, {'{vencimento}'}, {'{numero}'}, {'{total}'}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label>Cobrança de Parcela</Label>
                  <Textarea rows={5} {...register('templateCobranca')} className="font-mono text-xs" />
                  {errors.templateCobranca && <p className="text-xs text-destructive">{errors.templateCobranca.message}</p>}
                </div>
                <Separator />
                <div className="space-y-1">
                  <Label>Cobrança de Inadimplente</Label>
                  <Textarea rows={5} {...register('templateInadimplente')} className="font-mono text-xs" />
                </div>
                <Separator />
                <div className="space-y-1">
                  <Label>Confirmação de Pagamento</Label>
                  <Textarea rows={5} {...register('templateConfirmacaoPagamento')} className="font-mono text-xs" />
                </div>
              </CardContent>
            </Card>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar Templates
            </Button>
          </form>
        </TabsContent>

        {/* ─── Aba Aparência ─────────────────────────────────────────────── */}
        <TabsContent value="aparencia">
          <form onSubmit={aparenciaForm.handleSubmit(onSubmitAparencia)} className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Identidade Visual</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Personalize o nome e a logo exibidos no sistema. Cada alteração é salva no seu perfil.
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* App name */}
                <div className="space-y-1">
                  <Label>Nome do sistema *</Label>
                  <Input
                    placeholder="Minha Loja"
                    {...aparenciaForm.register('nomeApp')}
                    maxLength={30}
                  />
                  {aparenciaForm.formState.errors.nomeApp && (
                    <p className="text-xs text-destructive">{aparenciaForm.formState.errors.nomeApp.message}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Aparece na barra lateral e na aba do navegador</p>
                </div>

                <Separator />

                {/* Logo upload */}
                <div className="space-y-3">
                  <Label>Logo</Label>

                  {/* Preview */}
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center overflow-hidden bg-muted">
                      {currentLogoUrl ? (
                        <Image
                          src={currentLogoUrl}
                          alt="Logo"
                          width={64}
                          height={64}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ShoppingBag className="h-8 w-8 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingLogo}
                        >
                          {uploadingLogo ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{uploadProgress}%</>
                          ) : (
                            <><Upload className="mr-2 h-4 w-4" />Enviar logo</>
                          )}
                        </Button>
                        {currentLogoUrl && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={handleRemoveLogo}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        PNG, JPG ou SVG. Máximo 2MB. Recomendado: quadrado (ex: 512×512px)
                      </p>
                    </div>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                </div>

                {/* Live preview */}
                <Separator />
                <div className="space-y-2">
                  <Label>Pré-visualização da barra lateral</Label>
                  <div className="border rounded-lg p-3 bg-card flex items-center gap-2 w-fit">
                    {currentLogoUrl ? (
                      <Image src={currentLogoUrl} alt="Logo" width={32} height={32} className="rounded-lg object-cover" />
                    ) : (
                      <div className="bg-primary rounded-lg p-1.5">
                        <ShoppingBag className="h-5 w-5 text-primary-foreground" />
                      </div>
                    )}
                    <span className="font-bold text-sm">
                      {aparenciaForm.watch('nomeApp') || 'Minha Loja'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button type="submit" disabled={savingAparencia || uploadingLogo} className="w-full">
              {savingAparencia ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar Aparência
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  )
}

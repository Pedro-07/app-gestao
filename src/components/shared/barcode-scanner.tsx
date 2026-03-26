'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Camera, CameraOff, Loader2, ScanLine } from 'lucide-react'
import { toast } from 'sonner'

interface BarcodeScannerProps {
  onDetected: (code: string) => void
  /** Show the scanner trigger as a small icon button next to an input */
  compact?: boolean
  /** Label shown on the open button (default: "Ler código") */
  label?: string
}

declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>
  constructor(options: { formats: string[] })
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue: string }>>
}

export function BarcodeScanner({ onDetected, compact = false, label = 'Ler código' }: BarcodeScannerProps) {
  const [open, setOpen] = useState(false)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [scanning, setScanning] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<BarcodeDetector | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    setSupported('BarcodeDetector' in window)
  }, [])

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setScanning(false)
  }, [])

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (!videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play()

      if (!detectorRef.current) {
        detectorRef.current = new BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'],
        })
      }

      setScanning(true)

      const scan = async () => {
        if (!videoRef.current || !detectorRef.current) return
        if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
          try {
            const results = await detectorRef.current.detect(videoRef.current)
            if (results.length > 0) {
              const code = results[0].rawValue
              stopCamera()
              setOpen(false)
              onDetected(code)
              toast.success(`Código lido: ${code}`)
              return
            }
          } catch { /* frame not ready */ }
        }
        rafRef.current = requestAnimationFrame(scan)
      }
      rafRef.current = requestAnimationFrame(scan)
    } catch (err) {
      console.error(err)
      toast.error('Não foi possível acessar a câmera')
      stopCamera()
    }
  }, [onDetected, stopCamera])

  function handleOpen() {
    setManualCode('')
    setOpen(true)
  }

  useEffect(() => {
    if (open && supported) {
      startCamera()
    } else {
      stopCamera()
    }
    return () => stopCamera()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!manualCode.trim()) return
    setOpen(false)
    onDetected(manualCode.trim())
  }

  const trigger = compact ? (
    <Button type="button" variant="outline" size="icon" className="shrink-0 h-9 w-9" onClick={handleOpen} title={label}>
      <ScanLine className="h-4 w-4" />
    </Button>
  ) : (
    <Button type="button" variant="outline" onClick={handleOpen}>
      <ScanLine className="mr-2 h-4 w-4" />
      {label}
    </Button>
  )

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={(v) => { if (!v) stopCamera(); setOpen(v) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5" />
              Leitor de Código de Barras
            </DialogTitle>
          </DialogHeader>

          {supported === false ? (
            <div className="text-center space-y-3 py-4">
              <CameraOff className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                Seu navegador não suporta leitura automática.<br />
                Use Chrome ou Edge para ativar a câmera.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Camera preview */}
              <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                {!scanning && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-white" />
                  </div>
                )}
                {scanning && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="border-2 border-primary w-3/4 h-1/4 rounded-lg opacity-70" />
                  </div>
                )}
              </div>
              <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1">
                <Camera className="h-3 w-3" />
                Aponte a câmera para o código de barras
              </p>
            </div>
          )}

          {/* Manual fallback */}
          <div className="space-y-2 pt-1">
            <p className="text-xs text-muted-foreground text-center">— ou digite manualmente —</p>
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <Input
                placeholder="Digite o código..."
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="flex-1"
                autoFocus={supported === false}
              />
              <Button type="submit" size="sm" disabled={!manualCode.trim()}>OK</Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

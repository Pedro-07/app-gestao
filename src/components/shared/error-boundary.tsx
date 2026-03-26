'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="max-w-md w-full text-center space-y-5">
            <div className="flex justify-center">
              <div className="bg-red-100 dark:bg-red-950 rounded-full p-4">
                <AlertTriangle className="h-10 w-10 text-red-600" />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold">Algo deu errado</h2>
              <p className="text-sm text-muted-foreground">
                Ocorreu um erro inesperado na aplicação. Tente recarregar a página. Se o problema persistir, verifique sua conexão com a internet.
              </p>
            </div>

            {this.state.message && (
              <p className="text-xs font-mono bg-muted px-3 py-2 rounded text-left text-destructive break-all">
                {this.state.message}
              </p>
            )}

            <div className="flex gap-3 justify-center">
              <Button
                variant="outline"
                onClick={() => this.setState({ hasError: false, message: '' })}
              >
                Tentar novamente
              </Button>
              <Button onClick={() => window.location.reload()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Recarregar página
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

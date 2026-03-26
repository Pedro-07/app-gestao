import { RouteGuard } from '@/components/shared/route-guard'
import { Sidebar, BottomNav } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { DataPrefetcher } from '@/components/shared/data-prefetcher'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RouteGuard>
      {/* Carrega todas as coleções em background assim que auth confirma */}
      <DataPrefetcher />
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 lg:pb-6">
            {children}
          </main>
        </div>
      </div>
      <BottomNav />
    </RouteGuard>
  )
}

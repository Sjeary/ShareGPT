import { useEffect } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { useAdminStore } from '@/store/useAdminStore'
import { Titlebar } from '@/components/layout/Titlebar'
import { Shell } from '@/components/layout/Shell'
import { DevShell } from '@/components/layout/DevShell'
import { LoginScreen } from '@/components/LoginScreen'

export default function App() {
  const role = useAdminStore((s) => s.role)
  const init = useAdminStore((s) => s.init)
  const dark = useAdminStore((s) => s.dark)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <>
      {role === 'admin' ? (
        <Shell />
      ) : role === 'dev' ? (
        <DevShell />
      ) : (
        <div className="flex h-full flex-col bg-background text-foreground">
          <Titlebar />
          <LoginScreen />
        </div>
      )}
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" richColors />
    </>
  )
}

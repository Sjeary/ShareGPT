import { Button } from '@/components/ui/button'

export function LocalDataStatus({
  loading,
  error,
  onRetry,
}: {
  loading: boolean
  error: string
  onRetry: () => Promise<void>
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {error ? (
        <>
          <p role="alert" className="max-w-md text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" onClick={() => void onRetry()} disabled={loading}>
            重新加载
          </Button>
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          正在加载本机资料…
        </p>
      )}
    </div>
  )
}

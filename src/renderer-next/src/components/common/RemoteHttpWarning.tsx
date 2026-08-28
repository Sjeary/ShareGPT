import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { REMOTE_HTTP_WARNING } from '@/lib/remoteHttp'

export function RemoteHttpWarning() {
  return (
    <Alert variant="warning">
      <AlertTriangle className="size-4" />
      <AlertDescription>{REMOTE_HTTP_WARNING}</AlertDescription>
    </Alert>
  )
}

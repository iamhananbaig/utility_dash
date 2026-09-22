import { useEffect, useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { IconEye } from '@tabler/icons-react'
import { formatDateTime } from '@/lib/utils'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

interface LogEntry {
  id: number
  type: string
  status: string
  batch_id: number | null
  message: string
  details: Record<string, unknown> | null
  created_at: string
}

interface PaginatedLogs {
  data: LogEntry[]
  current_page: number
  last_page: number
  total: number
}

export function LogsPage() {
  const [logs, setLogs] = useState<PaginatedLogs | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterType, setFilterType] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), per_page: '50' })
    if (filterType !== 'all') params.set('type', filterType)
    if (filterStatus !== 'all') params.set('status', filterStatus)

    fetch(`${API_BASE}/logs?${params}`, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then(setLogs)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, filterType, filterStatus])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Activity Logs</h1>

      <div className="flex gap-2">
        <Select value={filterType} onValueChange={(v) => { setFilterType(v ?? 'all'); setPage(1) }}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="fetch">Fetch</SelectItem>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v ?? 'all'); setPage(1) }}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : logs ? (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No logs found.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.data.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDateTime(log.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={log.status === 'success' ? 'default' : 'destructive'}
                        >
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-md truncate">
                        {log.message}
                      </TableCell>
                      <TableCell>
                        {log.details && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedLog(log)}
                          >
                            <IconEye className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {logs.current_page} of {logs.last_page} ({logs.total} total)
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= logs.last_page}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : null}

      <Dialog open={!!selectedLog} onOpenChange={(open) => { if (!open) setSelectedLog(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedLog?.type} — {selectedLog?.status}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {formatDateTime(selectedLog?.created_at || '')}
            </p>
            <p className="text-sm">{selectedLog?.message}</p>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap break-all">
              {selectedLog?.details ? JSON.stringify(selectedLog.details, null, 2) : 'No details'}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

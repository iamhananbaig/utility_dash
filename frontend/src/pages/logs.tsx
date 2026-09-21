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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
                  <TableHead>Details</TableHead>
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
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        {log.details ? JSON.stringify(log.details) : '-'}
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
    </div>
  )
}

import { useEffect, useState, useCallback } from 'react'
import { fetchApi, bills as billsApi, locations as locationsApi, type FetchBatch, type Bill, type Location } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { IconCloudDownload, IconDownload, IconFile } from '@tabler/icons-react'
import { formatDate } from '@/lib/utils'

export function FetchPage() {
  const [locationsList, setLocationsList] = useState<Location[]>([])
  const [filterLocation, setFilterLocation] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterProvider, setFilterProvider] = useState<string>('iesco')
  const [batch, setBatch] = useState<FetchBatch | null>(null)
  const [fetching, setFetching] = useState(false)
  const [results, setResults] = useState<Bill[]>([])
  const [pdfStatus, setPdfStatus] = useState<{ total: number; generated: number; pending: number; jobs_pending: number; jobs_running: number } | null>(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)

  const loadPdfStatus = () => {
    billsApi.pdfStatus().then(setPdfStatus).catch(() => {})
  }

  useEffect(() => {
    locationsApi.list().then(setLocationsList)
    loadPdfStatus()
    // Always poll PDF status every 3 seconds
    const interval = setInterval(loadPdfStatus, 3000)
    // Load latest fetch batch and poll if running
    fetchApi.latest().then((latest) => {
      if (latest && (latest.status === 'running' || latest.status === 'pending')) {
        setBatch(latest)
        pollStatus(latest.batch_id)
      } else if (latest) {
        setBatch(latest)
        if (latest.status === 'completed') {
          fetchApi.results(latest.batch_id).then(setResults).catch(() => {})
        }
      }
    }).catch(() => {})
    return () => clearInterval(interval)
  }, [])

  const pollStatus = useCallback(
    async (batchId: number) => {
      const status = await fetchApi.status(batchId)
      setBatch(status)

      if (status.status === 'completed') {
        const res = await fetchApi.results(batchId)
        setResults(res)
        setFetching(false)
        return
      }

      setTimeout(() => pollStatus(batchId), 2000)
    },
    [],
  )

  const startFetch = async () => {
    setFetching(true)
    setResults([])
    setBatch(null)

    const params: { location_id?: number; property_type?: string; provider?: string } = {}
    if (filterLocation !== 'all') params.location_id = Number(filterLocation)
    if (filterType !== 'all') params.property_type = filterType
    if (filterProvider) params.provider = filterProvider

    const response = await fetchApi.start(params)

    if (response.total_refs === 0) {
      setFetching(false)
      alert('No active properties found to fetch.')
      return
    }

    setBatch({
      batch_id: response.batch_id,
      total_refs: response.total_refs,
      completed: 0,
      success_count: 0,
      fail_count: 0,
      status: 'running',
      progress: 0,
    })

    pollStatus(response.batch_id)
  }

  const handleGeneratePdf = async () => {
    setGeneratingPdf(true)
    try {
      const result = await billsApi.generatePdf()
      alert(result.message)
      // Poll for completion
      setTimeout(loadPdfStatus, 2000)
    } finally {
      setGeneratingPdf(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Fetch Bills</h1>

      <Card>
        <CardHeader>
          <CardTitle>Fetch Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">Provider</label>
              <Select value={filterProvider} onValueChange={(v) => setFilterProvider(v ?? 'iesco')}>
                <SelectTrigger>
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="iesco">IESCO</SelectItem>
                  <SelectItem value="lesco">LESCO</SelectItem>
                  <SelectItem value="qesco">QESCO</SelectItem>
                  <SelectItem value="gesco">GESCO</SelectItem>
                  <SelectItem value="fesco">FESCO</SelectItem>
                  <SelectItem value="tesco">TESCO</SelectItem>
                  <SelectItem value="sepco">SEPCO</SelectItem>
                  <SelectItem value="hesco">HESCO</SelectItem>
                  <SelectItem value="mepco">MEPCO</SelectItem>
                  <SelectItem value="pesco">PESCO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium">Location</label>
              <Select value={filterLocation} onValueChange={(v) => setFilterLocation(v ?? 'all')}>
                <SelectTrigger>
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locationsList.map((loc) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>
                      {loc.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium">Property Type</label>
              <Select value={filterType} onValueChange={(v) => setFilterType(v ?? 'all')}>
                <SelectTrigger>
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="branch">Branch</SelectItem>
                  <SelectItem value="hostel">Hostel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={startFetch} disabled={fetching}>
              <IconCloudDownload className="mr-2 h-4 w-4" />
              {fetching ? 'Fetching...' : 'Fetch Bills'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {batch && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Progress</span>
              <Badge variant={batch.status === 'completed' ? 'default' : 'secondary'}>
                {batch.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={batch.progress} className="h-3" />
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{batch.completed}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">{batch.success_count}</p>
                <p className="text-xs text-muted-foreground">Success</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">{batch.fail_count}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{batch.total_refs}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
            {batch.status === 'completed' && (
              <Button
                variant="outline"
                onClick={() => fetchApi.download(batch.batch_id)}
              >
                <IconDownload className="mr-2 h-4 w-4" />
                Download Excel
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Results ({results.length} bills)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Month</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Ref No</TableHead>
                    <TableHead>Payable</TableHead>
                    <TableHead>Comparison</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((bill, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">
                        {bill.property?.name || '-'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {bill.property?.location?.code || '-'}
                      </TableCell>
                      <TableCell>{formatDate(bill.bill_month)}</TableCell>
                      <TableCell>{formatDate(bill.due_date)}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {bill.property?.reference_no || '-'}
                      </TableCell>
                      <TableCell>Rs. {bill.website_payable?.toLocaleString() || 0}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            bill.comparison_status === 'MATCHED' ? 'default' : 'destructive'
                          }
                        >
                          {bill.comparison_status || '-'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            bill.status === 'paid'
                              ? 'default'
                              : bill.status === 'unpaid'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {bill.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PDF Generation Section */}
      {pdfStatus && pdfStatus.total > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>PDF Generation</CardTitle>
            <Button onClick={handleGeneratePdf} disabled={generatingPdf || pdfStatus.pending === 0}>
              <IconFile className="mr-2 h-4 w-4" />
              {generatingPdf ? 'Generating...' : `Generate Pending PDFs (${pdfStatus.pending})`}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6 text-sm">
              <span>Total: <strong>{pdfStatus.total}</strong></span>
              <span className="text-green-600">Generated: <strong>{pdfStatus.generated}</strong></span>
              <span className="text-amber-600">Pending: <strong>{pdfStatus.pending}</strong></span>
            </div>
            {(pdfStatus.jobs_pending > 0 || pdfStatus.jobs_running > 0) && (
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                {pdfStatus.jobs_pending > 0 && (
                  <span>Queue: <strong>{pdfStatus.jobs_pending}</strong> waiting</span>
                )}
                {pdfStatus.jobs_running > 0 && (
                  <span className="text-blue-600">Running: <strong>{pdfStatus.jobs_running}</strong> jobs</span>
                )}
              </div>
            )}
            {(pdfStatus.jobs_pending > 0 || pdfStatus.jobs_running > 0) && (
              <p className="text-xs text-muted-foreground mt-2">PDFs are being generated in the background...</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

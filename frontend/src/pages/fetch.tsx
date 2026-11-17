import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchApi, bills as billsApi, locations as locationsApi, type FetchBatch, type Bill } from '@/lib/api'
import { useQuery } from '@/hooks/use-query'
import { notify } from '@/lib/notify'
import { isAbortError, waitForBatch } from '@/lib/poll'
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
import { formatDate, formatBillMonth } from '@/lib/utils'

export function FetchPage() {
  const [filterLocation, setFilterLocation] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterProvider, setFilterProvider] = useState<string>('iesco')
  const [batch, setBatch] = useState<FetchBatch | null>(null)
  const [starting, setStarting] = useState(false)
  const [results, setResults] = useState<Bill[]>([])
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [pdfTick, setPdfTick] = useState(0)

  const { data: locationsList = [] } = useQuery('locations', () => locationsApi.list())
  const { data: pdfStatus } = useQuery(`pdf-status:${pdfTick}`, () => billsApi.pdfStatus())

  const fetching = starting || batch?.status === 'running' || batch?.status === 'pending'

  // Refresh PDF queue status every 3 seconds.
  useEffect(() => {
    const interval = setInterval(() => setPdfTick((t) => t + 1), 3000)
    return () => clearInterval(interval)
  }, [])

  // Cancels any in-flight polling when the page unmounts.
  const abortRef = useRef(new AbortController())

  const followBatch = useCallback(async (batchId: number) => {
    try {
      const done = await waitForBatch(batchId, {
        signal: abortRef.current.signal,
        onProgress: setBatch,
      })
      if (done.status === 'completed') {
        setResults(await fetchApi.results(batchId))
        notify.success('Fetch complete', `${done.success_count} succeeded, ${done.fail_count} failed`)
      } else {
        notify.warning('Fetch failed', 'See the Logs page for details.')
      }
    } catch (err) {
      if (!isAbortError(err)) notify.error(err, 'Lost track of the fetch')
    }
  }, [])

  // On mount: resume the latest batch if it is still running, else show its results.
  useEffect(() => {
    const controller = new AbortController()
    abortRef.current = controller
    fetchApi
      .latest()
      .then((latest) => {
        if (!latest?.batch_id || controller.signal.aborted) return
        setBatch(latest)
        if (latest.status === 'running' || latest.status === 'pending') {
          followBatch(latest.batch_id)
        } else if (latest.status === 'completed') {
          return fetchApi.results(latest.batch_id).then(setResults)
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [followBatch])

  const startFetch = async () => {
    setStarting(true)
    setResults([])
    setBatch(null)

    const params: { location_id?: number; property_type?: string; provider?: string } = {}
    if (filterLocation !== 'all') params.location_id = Number(filterLocation)
    if (filterType !== 'all') params.property_type = filterType
    if (filterProvider) params.provider = filterProvider

    try {
      const response = await fetchApi.start(params)
      if (response.total_refs === 0) {
        notify.info('Nothing to fetch', 'No active properties match these filters.')
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
      followBatch(response.batch_id)
    } catch (err) {
      notify.error(err, 'Could not start fetch')
    } finally {
      setStarting(false)
    }
  }

  const handleGeneratePdf = async () => {
    setGeneratingPdf(true)
    try {
      const result = await billsApi.generatePdf()
      notify.success('PDF generation queued', result.message)
      setPdfTick((t) => t + 1)
    } catch (err) {
      notify.error(err, 'Could not queue PDF generation')
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
              <Select items={[{ value: 'iesco', label: 'IESCO' }, { value: 'lesco', label: 'LESCO' }, { value: 'qesco', label: 'QESCO' }, { value: 'gesco', label: 'GESCO' }, { value: 'fesco', label: 'FESCO' }, { value: 'tesco', label: 'TESCO' }, { value: 'sepco', label: 'SEPCO' }, { value: 'hesco', label: 'HESCO' }, { value: 'mepco', label: 'MEPCO' }, { value: 'pesco', label: 'PESCO' }]} value={filterProvider} onValueChange={(v) => setFilterProvider(v ?? 'iesco')}>
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
              <Select items={[{ value: 'all', label: 'All Locations' }, ...locationsList.map((loc) => ({ value: String(loc.id), label: loc.code }))]} value={filterLocation} onValueChange={(v) => setFilterLocation(v ?? 'all')}>
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
              <Select items={[{ value: 'all', label: 'All Types' }, { value: 'branch', label: 'Branch' }, { value: 'hostel', label: 'Hostel' }]} value={filterType} onValueChange={(v) => setFilterType(v ?? 'all')}>
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
                      <TableCell>{formatBillMonth(bill.bill_month)}</TableCell>
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

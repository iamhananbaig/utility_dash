import { useEffect, useState, useCallback, useRef } from 'react'
import {
  bills as billsApi,
  locations as locationsApi,
  type Bill,
  type Location,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  IconSearch,
  IconDownload,
  IconCheck,
  IconPrinter,
  IconFile,
} from '@tabler/icons-react'
import { formatDate } from '@/lib/utils'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

function buildPrintHtml(htmlParts: string[]): string {
  const cacheBust = `?v=${Date.now()}`
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<base href="https://bill.pitc.com.pk/iescobill/" />
<style>
  @page { size: A4 portrait; margin: 10mm; }
  .bill-page { page-break-after: always; }
  .bill-page:last-child { page-break-after: auto; }
  body { margin: 0; padding: 0; }
  .bill-loader, .bill-loader--hide, noscript { display: none !important; }
</style>
<link rel="stylesheet" href="CSS/bill-print.css${cacheBust}" />
</head>
<body>
${htmlParts.join('\n')}
</body>
</html>`
}

function printIframe(combinedHtml: string): boolean {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.top = '-9999px'
  iframe.style.left = '-9999px'
  iframe.style.width = '210mm'
  iframe.style.height = '297mm'
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentWindow?.document
  if (!iframeDoc) {
    document.body.removeChild(iframe)
    return false
  }

  iframeDoc.open()
  iframeDoc.write(combinedHtml)
  iframeDoc.close()

  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.print()
      setTimeout(() => document.body.removeChild(iframe), 1000)
    }, 2000)
  }
  return true
}

export function BillsPage() {
  const [data, setData] = useState<Bill[]>([])
  const [locationsList, setLocationsList] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterLocation, setFilterLocation] = useState<string>('all')
  const [filterMonth, setFilterMonth] = useState('')
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null)
  const [statusForm, setStatusForm] = useState({ status: 'disputed', payment_note: '' })
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [isPrinting, setIsPrinting] = useState(false)
  const [processDialogOpen, setProcessDialogOpen] = useState(false)
  const [processForm, setProcessForm] = useState({
    instruction_id: '',
    batch_no: '',
    voucher_no: '',
  })
  const [processSaving, setProcessSaving] = useState(false)
  const [bulkProcessOpen, setBulkProcessOpen] = useState(false)
  const [bulkFile, setBulkFile] = useState<File | null>(null)
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const bulkFileRef = useRef<HTMLInputElement>(null)
  const [editAmountOpen, setEditAmountOpen] = useState(false)
  const [editAmountBill, setEditAmountBill] = useState<Bill | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false)
  const [pdfDialogBill, setPdfDialogBill] = useState<Bill | null>(null)
  const [generatingPdfId, setGeneratingPdfId] = useState<number | null>(null)
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [payDialogBill, setPayDialogBill] = useState<Bill | null>(null)
  const [payDialogBulk, setPayDialogBulk] = useState(false)
  const [payForm, setPayForm] = useState({
    batch_no: '',
    instruction_id: '',
    payment_date: new Date().toISOString().split('T')[0],
  })
  const [paySaving, setPaySaving] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, string> = { page: String(page), per_page: '50' }
    if (search) params.search = search
    if (filterStatus !== 'all') params.status = filterStatus
    if (filterLocation !== 'all') params.location_id = filterLocation
    if (filterMonth) params.bill_month = filterMonth
    billsApi
      .list(params)
      .then((res) => {
        setData(res.data)
        setLastPage(res.last_page)
        setTotal(res.total)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    locationsApi.list().then(setLocationsList)
  }, [])

  useEffect(() => {
    load()
  }, [page, search, filterStatus, filterLocation, filterMonth])

  const markPaid = async (id: number) => {
    setPayDialogBill(data.find(b => b.id === id) || null)
    setPayDialogBulk(false)
    setPayForm({ batch_no: '', instruction_id: '', payment_date: new Date().toISOString().split('T')[0] })
    setPayDialogOpen(true)
  }

  const openBulkPayDialog = () => {
    if (selectedIds.size === 0) return
    setPayDialogBill(null)
    setPayDialogBulk(true)
    setPayForm({ batch_no: '', instruction_id: '', payment_date: new Date().toISOString().split('T')[0] })
    setPayDialogOpen(true)
  }

  const submitPay = async () => {
    if (!payForm.batch_no.trim()) return
    setPaySaving(true)
    try {
      if (payDialogBulk) {
        await billsApi.bulkMarkPaid({
          ids: Array.from(selectedIds),
          batch_no: payForm.batch_no,
          instruction_id: payForm.instruction_id || undefined,
          payment_date: payForm.payment_date || undefined,
        })
      } else if (payDialogBill) {
        await billsApi.markPaidWithDetails(payDialogBill.id, {
          batch_no: payForm.batch_no,
          instruction_id: payForm.instruction_id || undefined,
          payment_date: payForm.payment_date || undefined,
        })
      }
      setPayDialogOpen(false)
      setSelectedIds(new Set())
      load()
    } catch (err: unknown) {
      const error = err as { message?: string }
      alert(error.message || 'Failed to mark as paid')
    } finally {
      setPaySaving(false)
    }
  }

  const openProcessDialog = (bill: Bill) => {
    setSelectedBill(bill)
    setProcessForm({
      instruction_id: '',
      batch_no: '',
      voucher_no: '',
    })
    setProcessDialogOpen(true)
  }

  const submitProcess = async () => {
    if (!selectedBill || !processForm.voucher_no.trim()) return
    setProcessSaving(true)
    try {
      await billsApi.process(selectedBill.id, {
        instruction_id: processForm.instruction_id || undefined,
        batch_no: processForm.batch_no || undefined,
        voucher_no: processForm.voucher_no,
      })
      setProcessDialogOpen(false)
      load()
    } finally {
      setProcessSaving(false)
    }
  }

  const submitBulkProcess = async () => {
    if (!bulkFile) return
    setBulkProcessing(true)
    try {
      const result = await billsApi.bulkProcess(bulkFile)
      alert(result.message)
      setBulkProcessOpen(false)
      setBulkFile(null)
      load()
    } finally {
      setBulkProcessing(false)
    }
  }

  const openEditAmount = (bill: Bill) => {
    setEditAmountBill(bill)
    setEditAmount(String(bill.website_payable))
    setEditAmountOpen(true)
  }

  const saveEditAmount = async () => {
    if (!editAmountBill) return
    await billsApi.updateAmount(editAmountBill.id, { website_payable: Number(editAmount) })
    setEditAmountOpen(false)
    load()
  }

  const handlePdfClick = (bill: Bill) => {
    if (bill.pdf_generated_at) {
      window.open(billsApi.pdf(bill.id), '_blank')
    } else {
      setPdfDialogBill(bill)
      setPdfDialogOpen(true)
    }
  }

  const generatePdfForBill = async (billId: number) => {
    setGeneratingPdfId(billId)
    try {
      await billsApi.generatePdf({ ids: [billId] })
      // Poll until generated
      const check = async () => {
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000))
          const status = await billsApi.pdfStatus()
          if (status.generated > 0) {
            window.open(billsApi.pdf(billId), '_blank')
            setPdfDialogOpen(false)
            setGeneratingPdfId(null)
            load()
            return
          }
        }
        setGeneratingPdfId(null)
        alert('PDF generation is taking longer than expected. Please try again later.')
      }
      check()
    } catch {
      setGeneratingPdfId(null)
    }
  }

  const openStatusDialog = (bill: Bill) => {
    setSelectedBill(bill)
    setStatusForm({ status: 'disputed', payment_note: '' })
    setStatusDialogOpen(true)
  }

  const updateStatus = async () => {
    if (!selectedBill) return
    await billsApi.updateStatus(selectedBill.id, statusForm)
    setStatusDialogOpen(false)
    load()
  }

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === data.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(data.map((b) => b.id)))
    }
  }

  const handlePrintSingle = useCallback(async (billId: number) => {
    setIsPrinting(true)
    try {
      const res = await fetch(billsApi.html(billId))
      if (!res.ok) return
      const html = await res.text()
      printIframe(buildPrintHtml([`<div class="bill-page">${html}</div>`]))
    } finally {
      setIsPrinting(false)
    }
  }, [])

  const handlePrintMultiple = useCallback(async () => {
    if (selectedIds.size === 0) return
    setIsPrinting(true)
    try {
      const htmlParts: string[] = []
      let idx = 0
      for (const id of selectedIds) {
        const res = await fetch(billsApi.html(id))
        if (res.ok) {
          let html = await res.text()
          // Rewrite all element IDs to be unique per bill (fixes duplicate ID issue)
          const prefix = `b${idx}_`
          html = html.replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`)
          html = html.replace(/\bid='([^']+)'/g, `id='${prefix}$1'`)
          // Fix for attributes that reference IDs: for, href="#..."
          html = html.replace(/\bfor="([^"]+)"/g, `for="${prefix}$1"`)
          html = html.replace(/href="#([^"]+)"/g, `href="#${prefix}$1"`)
          // Fix JavaScript getElementById references
          html = html.replace(/getElementById\("([^"]+)"\)/g, `getElementById("${prefix}$1")`)
          html = html.replace(/getElementById\('([^']+)'\)/g, `getElementById('${prefix}$1')`)
          // Fix querySelector references to IDs
          html = html.replace(/querySelector\("#([^"]+)"\)/g, `querySelector("#${prefix}$1")`)
          // Add per-bill QR initialization script
          const qrScript = `<script>
(function(){
  var host = document.getElementById("${prefix}charges_qrcode_1");
  var textEl = document.getElementById("${prefix}charges_qr_text_1");
  if (!host || !textEl) return;
  var text = textEl.value || textEl.textContent || "";
  if (!text.trim()) return;
  host.setAttribute("data-bill-qr-init", "1");
  var QR_MODULE_URL = "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm";
  import(QR_MODULE_URL).then(function(module) {
    var QRCode = module.default;
    host.innerHTML = "";
    var canvas = document.createElement("canvas");
    canvas.className = "bill-qr-canvas bill-qr-canvas--charges";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "QR code");
    host.appendChild(canvas);
    return QRCode.toCanvas(canvas, text, {
      errorCorrectionLevel: "L",
      width: 300,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" }
    });
  }).then(function() {
    if (host.firstChild) {
      host.firstChild.style.width = "150px";
      host.firstChild.style.height = "150px";
      host.firstChild.style.display = "block";
    }
  }).catch(function(){});
})();
<\/script>`
          htmlParts.push(`<div class="bill-page">${html}${qrScript}</div>`)
          idx++
        }
      }
      if (htmlParts.length > 0) {
        printIframe(buildPrintHtml(htmlParts))
      }
    } finally {
      setIsPrinting(false)
    }
  }, [selectedIds])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Bills ({total})</h1>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <>
              <Button onClick={openBulkPayDialog}>
                <IconCheck className="mr-2 h-4 w-4" />
                Mark Paid ({selectedIds.size})
              </Button>
              <Button onClick={handlePrintMultiple} disabled={isPrinting}>
                <IconPrinter className="mr-2 h-4 w-4" />
                {isPrinting ? 'Printing...' : `Print Selected (${selectedIds.size})`}
              </Button>
              <a
                href={`${API_BASE}/bills/bulk-pdf?ids=${Array.from(selectedIds).join('&ids[]=')}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline">
                  <IconFile className="mr-2 h-4 w-4 text-red-600" />
                  PDF Selected ({selectedIds.size})
                </Button>
              </a>
            </>
          )}
          <Button variant="outline" onClick={() => setBulkProcessOpen(true)}>
            Bulk Process
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              billsApi.export({ status: filterStatus !== 'all' ? filterStatus : '' })
            }
          >
            <IconDownload className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by property name or ref..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={filterStatus}
          onValueChange={(v) => {
            setFilterStatus(v ?? 'all')
            setPage(1)
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="in_process">In Process</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="disputed">Disputed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filterLocation}
          onValueChange={(v) => {
            setFilterLocation(v ?? 'all')
            setPage(1)
          }}
        >
          <SelectTrigger className="w-40">
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
        <Input
          placeholder="Bill month (e.g. Jan 2025)"
          value={filterMonth}
          onChange={(e) => {
            setFilterMonth(e.target.value)
            setPage(1)
          }}
          className="w-48"
        />
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === data.length && data.length > 0}
                      onChange={toggleSelectAll}
                      className="h-4 w-4"
                    />
                  </TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Ref No</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Payable</TableHead>
                  <TableHead>Comparison</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((bill) => (
                  <TableRow key={bill.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(bill.id)}
                        onChange={() => toggleSelect(bill.id)}
                        className="h-4 w-4"
                      />
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{bill.property?.name || '-'}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {bill.property?.reference_no || '-'}
                    </TableCell>
                    <TableCell>{formatDate(bill.bill_month)}</TableCell>
                    <TableCell>{formatDate(bill.due_date)}</TableCell>
                    <TableCell>
                      {bill.status === 'paid' ? (
                        <span className="font-medium text-muted-foreground">
                          Rs. {bill.website_payable.toLocaleString()}
                        </span>
                      ) : (
                        <button
                          onClick={() => openEditAmount(bill)}
                          className="font-medium text-primary hover:underline cursor-pointer"
                          title="Click to edit amount"
                        >
                          Rs. {bill.website_payable.toLocaleString()}
                        </button>
                      )}
                    </TableCell>
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
                            : bill.status === 'in_process'
                              ? 'outline'
                              : bill.status === 'unpaid'
                                ? 'destructive'
                                : 'secondary'
                        }
                      >
                        {bill.status === 'in_process' ? 'in process' : bill.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {bill.status === 'unpaid' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openProcessDialog(bill)}
                            title="Process Payment"
                          >
                            <IconCheck className="h-4 w-4 text-amber-600" />
                          </Button>
                        )}
                        {bill.status === 'in_process' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => markPaid(bill.id)}
                            title="Mark as Paid"
                          >
                            <IconCheck className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openStatusDialog(bill)}
                          title="Change Status"
                        >
                          <IconCheck className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handlePrintSingle(bill.id)}
                          disabled={isPrinting}
                          title="Print Bill"
                        >
                          <IconPrinter className="h-4 w-4" />
                        </Button>
                        <button
                          onClick={() => handlePdfClick(bill)}
                          title="Download PDF"
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted"
                        >
                          <IconFile className="h-4 w-4 text-red-600" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      No bills found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {lastPage}
              {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
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
                disabled={page >= lastPage}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Bill Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Status</label>
              <Select
                value={statusForm.status}
                onValueChange={(v) =>
                  setStatusForm({ ...statusForm, status: v ?? 'disputed' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="disputed">Disputed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Note</label>
              <Input
                value={statusForm.payment_note}
                onChange={(e) =>
                  setStatusForm({ ...statusForm, payment_note: e.target.value })
                }
                placeholder="Optional note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={updateStatus}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Process Payment Dialog */}
      <Dialog open={processDialogOpen} onOpenChange={setProcessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Voucher No <span className="text-destructive">*</span></label>
              <Input
                value={processForm.voucher_no}
                onChange={(e) => setProcessForm({ ...processForm, voucher_no: e.target.value })}
                placeholder="Required"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Instruction ID</label>
              <Input
                value={processForm.instruction_id}
                onChange={(e) => setProcessForm({ ...processForm, instruction_id: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Batch No</label>
              <Input
                value={processForm.batch_no}
                onChange={(e) => setProcessForm({ ...processForm, batch_no: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcessDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitProcess} disabled={!processForm.voucher_no.trim() || processSaving}>
              {processSaving ? 'Saving...' : 'Process'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Process Dialog */}
      <Dialog open={bulkProcessOpen} onOpenChange={setBulkProcessOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Process Payments</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload Excel with columns: <strong>reference_no</strong>, <strong>voucher_no</strong> (required),{' '}
              <strong>instruction_id</strong>, <strong>batch_no</strong>, <strong>date</strong> (optional).
            </p>
            <input
              ref={bulkFileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => setBulkFile(e.target.files?.[0] || null)}
            />
            <Button variant="outline" onClick={() => bulkFileRef.current?.click()}>
              {bulkFile ? bulkFile.name : 'Select File'}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkProcessOpen(false); setBulkFile(null) }}>
              Cancel
            </Button>
            <Button onClick={submitBulkProcess} disabled={!bulkFile || bulkProcessing}>
              {bulkProcessing ? 'Processing...' : 'Process'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Amount Dialog */}
      <Dialog open={editAmountOpen} onOpenChange={setEditAmountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Bill Amount</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {editAmountBill?.property?.name} — {formatDate(editAmountBill?.bill_month)}
            </p>
            <div>
              <label className="text-sm font-medium">Website Payable (Rs.)</label>
              <Input
                type="number"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                min="0"
                step="0.01"
              />
            </div>
            {editAmountBill && (
              <p className="text-xs text-muted-foreground">
                Calculated: Rs. {editAmountBill.calculated_payable.toLocaleString()} ·
                Difference: Rs. {(editAmountBill.calculated_payable - Number(editAmount || 0)).toLocaleString()}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAmountOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEditAmount}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PDF Not Generated Dialog */}
      <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PDF Not Generated</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              PDF for <strong>{pdfDialogBill?.property?.name}</strong> ({formatDate(pdfDialogBill?.bill_month)}) has not been generated yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Click "Generate PDF" to create it now. This may take a few seconds.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPdfDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => pdfDialogBill && generatePdfForBill(pdfDialogBill.id)}
              disabled={generatingPdfId !== null}
            >
              {generatingPdfId !== null ? 'Generating...' : 'Generate PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark as Paid Dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {payDialogBulk
                ? `Mark ${selectedIds.size} Bill(s) as Paid`
                : `Mark as Paid — ${payDialogBill?.property?.name || ''}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Batch No <span className="text-destructive">*</span></label>
              <Input
                value={payForm.batch_no}
                onChange={(e) => setPayForm({ ...payForm, batch_no: e.target.value })}
                placeholder="e.g. BATCH-01 or SI"
              />
              <p className="text-xs text-muted-foreground mt-1">
                If batch is "SI", only one bill can be marked paid at a time.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Instruction ID</label>
              <Input
                value={payForm.instruction_id}
                onChange={(e) => setPayForm({ ...payForm, instruction_id: e.target.value })}
                placeholder="Optional — must be unique across all bills"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Payment Date</label>
              <Input
                type="date"
                value={payForm.payment_date}
                onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitPay}
              disabled={!payForm.batch_no.trim() || paySaving}
            >
              {paySaving ? 'Saving...' : 'Mark as Paid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

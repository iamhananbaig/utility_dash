import { useEffect, useState, useRef } from 'react'
import { payments as paymentsApi, bills as billsApi, type PaymentProof } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { IconUpload, IconPlus } from '@tabler/icons-react'
import { formatDate } from '@/lib/utils'

export function PaymentsPage() {
  const [data, setData] = useState<PaymentProof[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Manual entry form
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({
    reference_no: '',
    voucher_no: '',
    instruction_id: '',
    batch_no: '',
    payment_date: new Date().toISOString().split('T')[0],
    status: 'in_process' as 'in_process' | 'paid',
  })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    paymentsApi
      .list({ page: String(page), per_page: '50' })
      .then((res) => {
        setData(res.data)
        setLastPage(res.last_page)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const result = await paymentsApi.upload(file)
      alert(result.message)
      load()
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleManualSubmit = async () => {
    if (!form.reference_no.trim() || !form.voucher_no.trim()) return
    setSaving(true)
    try {
      const result = await billsApi.manualPayment(form)
      alert(result.message)
      setFormOpen(false)
      setForm({
        reference_no: '',
        voucher_no: '',
        instruction_id: '',
        batch_no: '',
        payment_date: new Date().toISOString().split('T')[0],
        status: 'in_process',
      })
      load()
    } catch (err: unknown) {
      const error = err as { message?: string }
      alert(error.message || 'Failed to process payment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Payments</h1>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <IconUpload className="mr-2 h-4 w-4" />
            {uploading ? 'Uploading...' : 'Upload Excel'}
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <IconPlus className="mr-2 h-4 w-4" />
            Manual Entry
          </Button>
        </div>
      </div>

      {/* Manual Entry Form */}
      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>Manual Payment Entry</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">Reference No <span className="text-destructive">*</span></label>
                <Input
                  value={form.reference_no}
                  onChange={(e) => setForm({ ...form, reference_no: e.target.value })}
                  placeholder="14-digit reference"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Voucher No <span className="text-destructive">*</span></label>
                <Input
                  value={form.voucher_no}
                  onChange={(e) => setForm({ ...form, voucher_no: e.target.value })}
                  placeholder="Voucher number"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Instruction ID</label>
                <Input
                  value={form.instruction_id}
                  onChange={(e) => setForm({ ...form, instruction_id: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Batch No</label>
                <Input
                  value={form.batch_no}
                  onChange={(e) => setForm({ ...form, batch_no: e.target.value })}
                  placeholder="Optional text"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Date</label>
                <Input
                  type="date"
                  value={form.payment_date}
                  onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Status <span className="text-destructive">*</span></label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: (v ?? 'in_process') as 'in_process' | 'paid' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_process">In Process</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button
                onClick={handleManualSubmit}
                disabled={!form.reference_no.trim() || !form.voucher_no.trim() || saving}
              >
                {saving ? 'Saving...' : 'Submit'}
              </Button>
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Upload an Excel file with columns:{' '}
            <strong>reference_no</strong>, <strong>voucher_no</strong> (required),{' '}
            <strong>instruction_id</strong>, <strong>batch_no</strong>, <strong>date</strong> (optional).
            Matching bills will be marked as <strong>in process</strong>.
          </p>
          <a
            href="/samples/payment_upload_sample.xlsx"
            download
            className="text-sm text-primary hover:underline"
          >
            Download Sample File
          </a>
        </CardContent>
      </Card>

      {/* Payment History */}
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Bill Month</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Date Uploaded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((proof) => (
                <TableRow key={proof.id}>
                  <TableCell>
                    <p className="font-medium">{proof.bill?.property?.name || '-'}</p>
                    <p className="text-xs text-muted-foreground">
                      {proof.bill?.property?.reference_no}
                    </p>
                  </TableCell>
                  <TableCell>{formatDate(proof.bill?.bill_month)}</TableCell>
                  <TableCell>{proof.original_name}</TableCell>
                  <TableCell className="text-sm">{proof.notes || '-'}</TableCell>
                  <TableCell>
                    {formatDate(proof.created_at)}
                  </TableCell>
                </TableRow>
              ))}
              {data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No payment proofs uploaded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {lastPage}
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
      )}
    </div>
  )
}

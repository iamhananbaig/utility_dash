import { useEffect, useState, useRef } from 'react'
import { payments as paymentsApi, type PaymentProof } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { IconUpload } from '@tabler/icons-react'
import { formatDate } from '@/lib/utils'

export function PaymentsPage() {
  const [data, setData] = useState<PaymentProof[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
        </div>
      </div>

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

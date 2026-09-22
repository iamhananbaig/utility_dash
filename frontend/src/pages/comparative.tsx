import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { IconSearch, IconPrinter } from '@tabler/icons-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

interface ComparativeResult {
  reference_no: string
  property_name: string | null
  location: string | null
  property_type: string
  meter_no: string | null
  error?: string
  comparative: {
    current_month: string
    prev_month: string
    last_year_same_month: string
    units: { current: number | null; prev: number | null; last_year: number | null }
    amount: { current: number | null; prev: number | null; last_year: number | null }
  }
}

function fmt(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '-'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num) || num === 0) return '-'
  return Math.round(num).toLocaleString('en-US')
}

function fmtRate(units: number | string | null | undefined, amount: number | string | null | undefined): string {
  const u = typeof units === 'string' ? parseFloat(units) : units
  const a = typeof amount === 'string' ? parseFloat(amount) : amount
  if (!u || u <= 0 || !a) return '-'
  const rate = Math.round(a / u)
  if (rate === 0) return '-'
  return rate.toLocaleString('en-US')
}

export function ComparativePage() {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<ComparativeResult[]>([])
  const [loading, setLoading] = useState(false)
  const [months, setMonths] = useState<{ current: string; prev: string; lastYear: string } | null>(null)

  const analyze = async () => {
    const refs = input.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
    if (refs.length === 0) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/comparative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reference_numbers: refs }),
      })
      const data = await res.json()
      setResults(data)
      if (data.length > 0 && data[0].comparative) {
        setMonths({
          current: data[0].comparative.current_month,
          prev: data[0].comparative.prev_month,
          lastYear: data[0].comparative.last_year_same_month,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  const printTable = () => {
    const content = document.getElementById('comparative-table')?.outerHTML
    if (!content) return
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!DOCTYPE html>
<html><head><title>Comparative Report</title>
<style>
  @page { size: landscape; margin: 10mm; }
  body { font-family: Arial, sans-serif; font-size: 9px; margin: 0; padding: 10px; }
  h2 { text-align: center; font-size: 12px; margin: 0 0 4px 0; }
  h3 { text-align: center; font-size: 10px; margin: 0 0 8px 0; color: #666; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #333; padding: 3px 5px; text-align: right; white-space: nowrap; }
  th { background: #f0f0f0; font-weight: bold; font-size: 8px; }
  td:first-child, th:first-child { text-align: left; }
  td:nth-child(2), th:nth-child(2) { text-align: left; }
  td:nth-child(3), th:nth-child(3) { text-align: left; }
</style></head><body>
<h2>Comparative Analysis Report</h2>
<h3>${months ? `${months.prev} vs ${months.current} vs ${months.lastYear}` : ''}</h3>
${content}
</body></html>`)
    win.document.close()
    win.print()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Comparative Analysis</h1>
        {results.length > 0 && (
          <Button onClick={printTable} variant="outline">
            <IconPrinter className="mr-2 h-4 w-4" />
            Print
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <textarea
              className="flex-1 h-24 rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Paste reference numbers, one per line or comma-separated..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <Button onClick={analyze} disabled={loading || !input.trim()} className="self-end">
              <IconSearch className="mr-2 h-4 w-4" />
              {loading ? 'Analyzing...' : 'Analyze'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && months && (
        <div id="comparative-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2}>Ref No</TableHead>
                <TableHead rowSpan={2}>Location</TableHead>
                <TableHead rowSpan={2}>Type</TableHead>
                <TableHead colSpan={3} className="text-center">Units Comparative</TableHead>
                <TableHead colSpan={3} className="text-center">Unit Rate Comparative</TableHead>
              </TableRow>
              <TableRow>
                <TableHead className="text-center text-xs">{months.prev}</TableHead>
                <TableHead className="text-center text-xs">{months.current}</TableHead>
                <TableHead className="text-center text-xs">{months.lastYear}</TableHead>
                <TableHead className="text-center text-xs">{months.prev}</TableHead>
                <TableHead className="text-center text-xs">{months.current}</TableHead>
                <TableHead className="text-center text-xs">{months.lastYear}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.reference_no}>
                  <TableCell className="font-mono text-xs">{r.reference_no}</TableCell>
                  <TableCell className="text-xs">{r.location || '-'}</TableCell>
                  <TableCell className="text-xs">{r.property_type}</TableCell>
                  <TableCell className="text-right text-xs">
                    {fmt(r.comparative.units.prev)}
                  </TableCell>
                  <TableCell className="text-right text-xs font-medium">
                    {fmt(r.comparative.units.current)}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {fmt(r.comparative.units.last_year)}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {fmtRate(r.comparative.units.prev, r.comparative.amount.prev)}
                  </TableCell>
                  <TableCell className="text-right text-xs font-medium">
                    {fmtRate(r.comparative.units.current, r.comparative.amount.current)}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {fmtRate(r.comparative.units.last_year, r.comparative.amount.last_year)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

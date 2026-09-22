import { useEffect, useState } from 'react'
import { locations as locationsApi, type Location } from '@/lib/api'
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
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

interface TrendData {
  location: { id: number; code: string }
  year: number
  months: string[]
  totals: number[]
  properties: Array<{
    reference_no: string
    name: string
    property_type: string
    monthly_amounts: Record<string, { amount: number; estimated: boolean } | null>
  }>
}

export function LocationTrendPage() {
  const [locationsList, setLocationsList] = useState<Location[]>([])
  const [selectedLocation, setSelectedLocation] = useState<string>('')
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [data, setData] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    locationsApi.list().then(setLocationsList)
  }, [])

  const loadTrend = () => {
    if (!selectedLocation) return
    setLoading(true)
    fetch(`${API_BASE}/locations/${selectedLocation}/trend?year=${year}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (selectedLocation) loadTrend()
  }, [selectedLocation, year])

  const chartData = data
    ? data.months.map((month, i) => ({
        name: month,
        total: data.totals[i],
      }))
    : []

  const currentYear = new Date().getFullYear()
  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Location Trend</h1>

      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <label className="text-sm font-medium">Location</label>
          <Select value={selectedLocation} onValueChange={(v) => setSelectedLocation(v ?? '')}>
            <SelectTrigger>
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              {locationsList.map((loc) => (
                <SelectItem key={loc.id} value={String(loc.id)}>
                  {loc.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32">
          <label className="text-sm font-medium">Year</label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}

      {data && !loading && (
        <>
          {/* Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle>
                Total Monthly Rent — {data.location.code} ({data.year})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.some((d) => d.total > 0) ? (
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value) => `Rs. ${Number(value).toLocaleString()}`}
                    />
                    <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-10">
                  No data available for this location and year.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Property Detail Table */}
          <Card>
            <CardHeader>
              <CardTitle>Property Details</CardTitle>
            </CardHeader>
            <CardContent>
              {data.properties.length === 0 ? (
                <p className="text-sm text-muted-foreground">No properties in this location.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10">Ref No</TableHead>
                        <TableHead className="sticky left-28 bg-background z-10">Property</TableHead>
                        <TableHead className="sticky left-56 bg-background z-10">Type</TableHead>
                        {data.months.map((month) => (
                          <TableHead key={month} className="text-right text-xs min-w-[80px]">
                            {month}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.properties.map((prop) => (
                        <TableRow key={prop.reference_no}>
                          <TableCell className="font-mono text-xs sticky left-0 bg-background z-10">
                            {prop.reference_no}
                          </TableCell>
                          <TableCell className="text-xs sticky left-28 bg-background z-10">
                            {prop.name}
                          </TableCell>
                          <TableCell className="sticky left-56 bg-background z-10">
                            <Badge variant="outline" className="text-xs">
                              {prop.property_type}
                            </Badge>
                          </TableCell>
                          {data.months.map((month) => {
                            const val = prop.monthly_amounts[month]
                            return (
                              <TableCell key={month} className="text-right text-xs">
                                {val ? (
                                  <span className={val.estimated ? 'text-muted-foreground italic' : ''}>
                                    {val.amount.toLocaleString()}
                                    {val.estimated && <span className="text-[10px] ml-0.5">*</span>}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            )
                          })}
                        </TableRow>
                      ))}
                      {/* Totals row */}
                      <TableRow className="font-bold border-t-2">
                        <TableCell className="sticky left-0 bg-background z-10">Total</TableCell>
                        <TableCell className="sticky left-28 bg-background z-10"></TableCell>
                        <TableCell className="sticky left-56 bg-background z-10"></TableCell>
                        {data.months.map((month, i) => (
                          <TableCell key={month} className="text-right text-xs">
                            {data.totals[i] > 0 ? data.totals[i].toLocaleString() : '-'}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                * Estimated from bill history fields (prior/last year data)
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

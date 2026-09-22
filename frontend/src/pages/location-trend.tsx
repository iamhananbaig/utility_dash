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

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return '-'
  return Math.round(value).toLocaleString('en-US')
}

function fmtRate(units: number | null | undefined, amount: number | null | undefined): string {
  if (!units || units <= 0 || !amount) return '-'
  const rate = Math.round(amount / units)
  if (rate === 0) return '-'
  return rate.toLocaleString('en-US')
}

interface MonthlyData {
  amount: number
  units: number | null
}

interface TrendData {
  location: { id: number; code: string }
  year: number
  months: string[]
  totals: number[]
  units_totals: number[]
  properties: Array<{
    reference_no: string
    name: string
    property_type: string
    monthly_data: Record<string, MonthlyData | null>
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
        units: data.units_totals[i],
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
          {/* Units Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle>
                Total Monthly Units — {data.location.code} ({data.year})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.some((d) => d.units > 0) ? (
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value) => `${Number(value).toLocaleString()} kWh`}
                    />
                    <Bar dataKey="units" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-10">
                  No data available for this location and year.
                </p>
              )}
            </CardContent>
          </Card>

          {data.properties.length > 0 && (
            <>
              {/* Units Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Units (kWh)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 bg-background z-10">Ref No</TableHead>
                          <TableHead className="sticky left-28 bg-background z-10">Property</TableHead>
                          <TableHead className="sticky left-56 bg-background z-10">Type</TableHead>
                          {data.months.map((month) => (
                            <TableHead key={month} className="text-right text-xs min-w-[80px]">{month}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.properties.map((prop) => (
                          <TableRow key={prop.reference_no}>
                            <TableCell className="font-mono text-xs sticky left-0 bg-background z-10">{prop.reference_no}</TableCell>
                            <TableCell className="text-xs sticky left-28 bg-background z-10">{prop.name}</TableCell>
                            <TableCell className="sticky left-56 bg-background z-10"><Badge variant="outline" className="text-xs">{prop.property_type}</Badge></TableCell>
                            {data.months.map((month) => (
                              <TableCell key={month} className="text-right text-xs">{fmt(prop.monthly_data[month]?.units)}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                        <TableRow className="font-bold border-t-2">
                          <TableCell className="sticky left-0 bg-background z-10">Total</TableCell>
                          <TableCell className="sticky left-28 bg-background z-10"></TableCell>
                          <TableCell className="sticky left-56 bg-background z-10"></TableCell>
                          {data.units_totals.map((total, i) => (
                            <TableCell key={i} className="text-right text-xs">{fmt(total)}</TableCell>
                          ))}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Rate Per Unit Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Rate Per Unit (Rs./kWh)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 bg-background z-10">Ref No</TableHead>
                          <TableHead className="sticky left-28 bg-background z-10">Property</TableHead>
                          <TableHead className="sticky left-56 bg-background z-10">Type</TableHead>
                          {data.months.map((month) => (
                            <TableHead key={month} className="text-right text-xs min-w-[80px]">{month}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.properties.map((prop) => (
                          <TableRow key={prop.reference_no}>
                            <TableCell className="font-mono text-xs sticky left-0 bg-background z-10">{prop.reference_no}</TableCell>
                            <TableCell className="text-xs sticky left-28 bg-background z-10">{prop.name}</TableCell>
                            <TableCell className="sticky left-56 bg-background z-10"><Badge variant="outline" className="text-xs">{prop.property_type}</Badge></TableCell>
                            {data.months.map((month) => {
                              const d = prop.monthly_data[month]
                              return (
                                <TableCell key={month} className="text-right text-xs">
                                  {fmtRate(d?.units, d?.amount)}
                                </TableCell>
                              )
                            })}
                          </TableRow>
                        ))}
                        <TableRow className="font-bold border-t-2">
                          <TableCell className="sticky left-0 bg-background z-10">Total</TableCell>
                          <TableCell className="sticky left-28 bg-background z-10"></TableCell>
                          <TableCell className="sticky left-56 bg-background z-10"></TableCell>
                          {data.months.map((month, i) => (
                            <TableCell key={month} className="text-right text-xs">
                              {fmtRate(data.units_totals[i], data.totals[i])}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Amount Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Amount (Rs.)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 bg-background z-10">Ref No</TableHead>
                          <TableHead className="sticky left-28 bg-background z-10">Property</TableHead>
                          <TableHead className="sticky left-56 bg-background z-10">Type</TableHead>
                          {data.months.map((month) => (
                            <TableHead key={month} className="text-right text-xs min-w-[80px]">{month}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.properties.map((prop) => (
                          <TableRow key={prop.reference_no}>
                            <TableCell className="font-mono text-xs sticky left-0 bg-background z-10">{prop.reference_no}</TableCell>
                            <TableCell className="text-xs sticky left-28 bg-background z-10">{prop.name}</TableCell>
                            <TableCell className="sticky left-56 bg-background z-10"><Badge variant="outline" className="text-xs">{prop.property_type}</Badge></TableCell>
                            {data.months.map((month) => (
                              <TableCell key={month} className="text-right text-xs">{fmt(prop.monthly_data[month]?.amount)}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                        <TableRow className="font-bold border-t-2">
                          <TableCell className="sticky left-0 bg-background z-10">Total</TableCell>
                          <TableCell className="sticky left-28 bg-background z-10"></TableCell>
                          <TableCell className="sticky left-56 bg-background z-10"></TableCell>
                          {data.totals.map((total, i) => (
                            <TableCell key={i} className="text-right text-xs">{fmt(total)}</TableCell>
                          ))}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}

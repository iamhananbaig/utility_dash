import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router'
import {
  properties as propertiesApi,
  type Property,
  type Bill,
  type ReferenceHistory,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { IconArrowLeft } from '@tabler/icons-react'
import { formatDate, formatDateTime } from '@/lib/utils'

export function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [property, setProperty] = useState<Property | null>(null)
  const [bills, setBills] = useState<Bill[]>([])
  const [history, setHistory] = useState<ReferenceHistory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    const propId = Number(id)
    Promise.all([
      propertiesApi.get(propId),
      propertiesApi.bills(propId),
      propertiesApi.history(propId),
    ])
      .then(([p, b, h]) => {
        setProperty(p)
        setBills(b)
        setHistory(h)
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  if (!property) {
    return <div className="text-muted-foreground">Property not found</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/properties">
          <Button variant="ghost" size="icon">
            <IconArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{property.name}</h1>
          <p className="text-sm text-muted-foreground">
            Ref: {property.reference_no} &middot;{' '}
            {property.location?.code || 'No location'}
          </p>
        </div>
        <Badge variant={property.status === 'active' ? 'default' : 'secondary'}>
          {property.status}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Reference No</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-lg">{property.reference_no}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Meter No</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-lg">{property.meter_no || '-'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Type</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">{property.property_type}</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bill History</CardTitle>
        </CardHeader>
        <CardContent>
          {bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bills fetched yet.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Arrears</TableHead>
                    <TableHead>Energy</TableHead>
                    <TableHead>Taxes</TableHead>
                    <TableHead>Payable</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.map((bill) => (
                    <TableRow key={bill.id}>
                      <TableCell className="font-medium">{formatDate(bill.bill_month)}</TableCell>
                      <TableCell>{formatDate(bill.due_date)}</TableCell>
                      <TableCell>Rs. {bill.arrears_amount.toLocaleString()}</TableCell>
                      <TableCell>Rs. {bill.energy_charges.toLocaleString()}</TableCell>
                      <TableCell>Rs. {bill.taxes_total.toLocaleString()}</TableCell>
                      <TableCell className="font-medium">
                        Rs. {bill.website_payable.toLocaleString()}
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reference Number History</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reference changes recorded.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Old Reference</TableHead>
                    <TableHead>New Reference</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>
                        {formatDateTime(h.changed_at)}
                      </TableCell>
                      <TableCell className="font-mono">{h.old_reference_no}</TableCell>
                      <TableCell className="font-mono">{h.new_reference_no}</TableCell>
                      <TableCell>{h.reason || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

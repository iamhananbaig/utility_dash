import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { dashboard, type DashboardData } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import {
  IconAlertTriangle,
  IconClock,
  IconCircleCheck,
} from '@tabler/icons-react'

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    dashboard
      .get()
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  if (!data) {
    return <div className="text-muted-foreground">Failed to load dashboard</div>
  }

  const { stats, recent_bills } = data

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Urgent Attention */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-red-700 dark:text-red-400">
              Overdue / Due Today
            </CardTitle>
            <IconAlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700 dark:text-red-400">
              {stats.urgent_bills}
            </div>
            <p className="text-xs text-red-600/70 dark:text-red-400/70">
              Rs. {stats.urgent_amount.toLocaleString()} — surcharge risk
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Due in 7 Days
            </CardTitle>
            <IconClock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">
              {stats.upcoming_bills}
            </div>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/70">
              Rs. {stats.upcoming_amount.toLocaleString()}
              {stats.upcoming_surcharge > 0 && (
                <> &middot; Surcharge: Rs. {stats.upcoming_surcharge.toLocaleString()}</>
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700 dark:text-green-400">
              Paid
            </CardTitle>
            <IconCircleCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700 dark:text-green-400">
              {stats.paid_bills}
            </div>
            <p className="text-xs text-green-600/70 dark:text-green-400/70">
              Rs. {stats.paid_amount.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Summary Row */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Meters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active_meters}</div>
            <p className="text-xs text-muted-foreground">{stats.total_locations} locations</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Unpaid</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.unpaid_bills}</div>
            <p className="text-xs text-muted-foreground">
              Rs. {stats.unpaid_amount.toLocaleString()}
              {stats.unpaid_earliest && (
                <> &middot; Due: {formatDate(stats.unpaid_earliest)}</>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">In Process</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.in_process_bills}</div>
            <p className="text-xs text-muted-foreground">
              Rs. {stats.in_process_amount.toLocaleString()}
              {stats.in_process_earliest && (
                <> &middot; Due: {formatDate(stats.in_process_earliest)}</>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Bills</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_bills}</div>
          </CardContent>
        </Card>
      </div>

      {/* Due Aging */}
      <h2 className="text-lg font-semibold mt-6">Bills Due</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Due Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">{stats.due_aging?.due_today || 0}</div>
            <p className="text-xs text-muted-foreground">
              Rs. {(stats.due_aging_amounts?.due_today || 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Due Tomorrow</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.due_aging?.due_tomorrow || 0}</div>
            <p className="text-xs text-muted-foreground">
              Rs. {(stats.due_aging_amounts?.due_tomorrow || 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Due Later</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.due_aging?.due_later || 0}</div>
            <p className="text-xs text-muted-foreground">
              Rs. {(stats.due_aging_amounts?.due_later || 0).toLocaleString()}
              {stats.due_later_earliest && (
                <> &middot; Earliest: {formatDate(stats.due_later_earliest)}</>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Bills */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Bills</CardTitle>
        </CardHeader>
        <CardContent>
          {recent_bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bills fetched yet.</p>
          ) : (
            <div className="space-y-2">
              {recent_bills.map((bill) => (
                <div
                  key={bill.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {bill.property?.name || 'Unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {bill.bill_month} &middot; {bill.property?.reference_no}
                      {bill.due_date && <> &middot; Due: {formatDate(bill.due_date)}</>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      Rs. {bill.website_payable.toLocaleString()}
                    </p>
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

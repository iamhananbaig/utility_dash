import { Link, useLocation } from 'react-router'
import {
  IconDashboard,
  IconBuilding,
  IconMapPin,
  IconCloudDownload,
  IconReceipt,
  IconCurrencyRupee,
  IconChartBar,
  IconChartLine,
  IconList,
} from '@tabler/icons-react'

const navItems = [
  { to: '/', label: 'Dashboard', icon: IconDashboard },
  { to: '/properties', label: 'Properties', icon: IconBuilding },
  { to: '/locations', label: 'Locations', icon: IconMapPin },
  { to: '/location-trend', label: 'Location Trend', icon: IconChartLine },
  { to: '/fetch', label: 'Fetch Bills', icon: IconCloudDownload },
  { to: '/bills', label: 'Bills', icon: IconReceipt },
  { to: '/payments', label: 'Payments', icon: IconCurrencyRupee },
  { to: '/comparative', label: 'Comparative', icon: IconChartBar },
  { to: '/logs', label: 'Activity Logs', icon: IconList },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r bg-card">
        <div className="flex h-14 items-center border-b px-4">
          <IconReceipt className="mr-2 h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">Utility Bills</span>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => {
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to)
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>
      <main className="ml-60 flex-1 p-6">{children}</main>
    </div>
  )
}

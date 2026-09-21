import { BrowserRouter, Routes, Route } from 'react-router'
import { Layout } from '@/components/layout'
import { DashboardPage } from '@/pages/dashboard'
import { PropertiesPage } from '@/pages/properties'
import { PropertyDetailPage } from '@/pages/property-detail'
import { LocationsPage } from '@/pages/locations'
import { LocationTrendPage } from '@/pages/location-trend'
import { FetchPage } from '@/pages/fetch'
import { BillsPage } from '@/pages/bills'
import { PaymentsPage } from '@/pages/payments'
import { ComparativePage } from '@/pages/comparative'
import { LogsPage } from '@/pages/logs'

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/properties/:id" element={<PropertyDetailPage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/location-trend" element={<LocationTrendPage />} />
          <Route path="/fetch" element={<FetchPage />} />
          <Route path="/bills" element={<BillsPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/comparative" element={<ComparativePage />} />
          <Route path="/logs" element={<LogsPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App

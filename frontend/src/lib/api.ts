const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || 'Request failed');
  }

  return response.json();
}

export interface Location {
  id: number;
  code: string;
  city: string;
  properties_count: number;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: number;
  name: string;
  reference_no: string;
  provider: string;
  meter_no: string | null;
  location_id: number;
  property_type: 'branch' | 'hostel';
  status: 'active' | 'inactive';
  notes: string | null;
  location?: Location;
  created_at: string;
  updated_at: string;
}

export interface Bill {
  id: number;
  property_id: number;
  provider: string;
  bill_month: string | null;
  issue_date: string | null;
  reading_date: string | null;
  due_date: string | null;
  arrears_amount: number;
  arrears_raw: string | null;
  energy_charges: number;
  taxes_total: number;
  fpa_taxes_total: number;
  advance_tax: number;
  calculated_payable: number;
  website_payable: number;
  payable_difference: number;
  comparison_status: string | null;
  status: 'unpaid' | 'in_process' | 'paid' | 'disputed' | 'cancelled';
  paid_at: string | null;
  paid_amount: number | null;
  payment_note: string | null;
  instruction_id: string | null;
  batch_no: string | null;
  voucher_no: string | null;
  payment_date: string | null;
  raw_data: Record<string, unknown> | null;
  pdf_generated_at: string | null;
  fetched_at: string;
  property?: Property;
  created_at: string;
  updated_at: string;
}

export interface FetchBatch {
  batch_id: number;
  total_refs: number;
  completed: number;
  success_count: number;
  fail_count: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
}

export interface ReferenceHistory {
  id: number;
  property_id: number;
  old_reference_no: string;
  new_reference_no: string;
  reason: string | null;
  changed_at: string;
  created_at: string;
}

export interface PaymentProof {
  id: number;
  bill_id: number;
  file_path: string;
  file_type: 'excel' | 'image';
  original_name: string;
  notes: string | null;
  bill?: Bill;
  created_at: string;
}

export interface LogEntry {
  id: number
  type: string
  status: string
  batch_id: number | null
  message: string
  details: Record<string, unknown> | null
  created_at: string
}

export interface DashboardData {
  stats: {
    active_meters: number;
    total_locations: number;
    total_bills: number;
    unpaid_bills: number;
    unpaid_amount: number;
    unpaid_earliest: string | null;
    in_process_bills: number;
    in_process_amount: number;
    in_process_earliest: string | null;
    paid_bills: number;
    paid_amount: number;
    urgent_bills: number;
    urgent_amount: number;
    upcoming_bills: number;
    upcoming_amount: number;
    upcoming_surcharge: number;
    due_aging: Record<string, number>;
    due_aging_amounts: Record<string, number>;
    due_later_earliest: string | null;
  };
  recent_bills: Bill[];
}

export interface PaginatedResponse<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

// Locations
export const locations = {
  list: () => request<Location[]>('/locations'),
  create: (data: { code: string; city: string }) =>
    request<Location>('/locations', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: { code: string; city: string }) =>
    request<Location>(`/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<{ message: string }>(`/locations/${id}`, { method: 'DELETE' }),
  import: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/locations/import`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Import failed');
    return data;
  },
};

// Properties
export const properties = {
  list: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<Property[]>(`/properties${query}`);
  },
  get: (id: number) => request<Property>(`/properties/${id}`),
  create: (data: Partial<Property>) =>
    request<Property>('/properties', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Property> & { reference_change_reason?: string }) =>
    request<Property>(`/properties/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<{ message: string }>(`/properties/${id}`, { method: 'DELETE' }),
  import: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/properties/import`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Import failed');
    return data;
  },
  bulkUpdateRef: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/properties/bulk-update-ref`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Import failed');
    return data;
  },
  bills: (id: number) => request<Bill[]>(`/properties/${id}/bills`),
  history: (id: number) => request<ReferenceHistory[]>(`/properties/${id}/history`),
};

// Bills
export const bills = {
  list: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<PaginatedResponse<Bill>>(`/bills${query}`);
  },
  process: (id: number, data: { instruction_id?: string; batch_no?: string; voucher_no: string }) =>
    request<Bill>(`/bills/${id}/process`, { method: 'PATCH', body: JSON.stringify(data) }),
  markPaid: (id: number) => request<Bill>(`/bills/${id}/pay`, { method: 'PATCH' }),
  markPaidWithDetails: (id: number, data: { batch_no: string; instruction_id?: string; payment_date?: string }) =>
    request<Bill>(`/bills/${id}/pay-details`, { method: 'PATCH', body: JSON.stringify(data) }),
  bulkMarkPaid: (data: { ids: number[]; batch_no: string; instruction_id?: string; payment_date?: string }) =>
    request<{ message: string; updated: number }>('/bills/bulk-mark-paid', { method: 'POST', body: JSON.stringify(data) }),
  updateStatus: (id: number, data: { status: string; payment_note?: string }) =>
    request<Bill>(`/bills/${id}/status`, { method: 'PATCH', body: JSON.stringify(data) }),
  updateAmount: (id: number, data: { website_payable: number }) =>
    request<Bill>(`/bills/${id}/amount`, { method: 'PATCH', body: JSON.stringify(data) }),
  bulkProcess: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/bills/bulk-process`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    });
    return response.json();
  },
  manualPayment: (data: {
    reference_no: string;
    voucher_no: string;
    instruction_id?: string;
    batch_no?: string;
    payment_date?: string;
    status: 'in_process' | 'paid';
  }) => request<{ message: string; bill: Bill }>('/bills/manual-payment', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  html: (id: number) => `${API_BASE}/bills/${id}/html`,
  pdf: (id: number) => `${API_BASE}/bills/${id}/pdf`,
  pdfStatus: () => request<{ total: number; generated: number; pending: number; jobs_pending: number; jobs_running: number }>('/bills/pdf-status'),
  generatePdf: (data?: { ids?: number[]; bill_month?: string }) =>
    request<{ message: string; queued: number }>('/bills/generate-pdf', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
  bulkPdf: (_ids: number[]) => {
    window.open(`${API_BASE}/bills/bulk-pdf`, '_blank')
  },
  export: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    window.open(`${API_BASE}/bills/export${query}`, '_blank');
  },
};

// Fetch
export const fetchApi = {
  start: (data?: { location_id?: number; property_type?: string; provider?: string }) =>
    request<{ batch_id: number; total_refs: number }>('/fetch', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
  latest: () => request<FetchBatch | null>('/fetch/latest'),
  status: (id: number) => request<FetchBatch>(`/fetch/${id}/status`),
  results: (id: number) => request<Bill[]>(`/fetch/${id}/results`),
  download: (id: number) => {
    window.open(`${API_BASE}/fetch/${id}/download`, '_blank');
  },
};

// Payments
export const payments = {
  list: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<PaginatedResponse<PaymentProof>>(`/payments${query}`);
  },
  upload: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/payments/upload`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    });
    return response.json();
  },
};

// Dashboard
export const dashboard = {
  get: () => request<DashboardData>('/dashboard'),
};

// Location Trend
export const locationTrend = {
  get: (locationId: number, year: number) =>
    request<{
      location: { id: number; code: string; name: string }
      year: number
      months: string[]
      totals: number[]
      properties: Array<{
        reference_no: string
        name: string
        property_type: string
        monthly_amounts: Record<string, { amount: number; estimated: boolean } | null>
      }>
    }>(`/locations/${locationId}/trend?year=${year}`),
};

// Logs
export const logs = {
  list: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<PaginatedResponse<LogEntry>>(`/logs${query}`);
  },
};

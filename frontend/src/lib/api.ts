export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export class ApiError extends Error {
  status: number;
  errors?: Record<string, string[]>;

  constructor(message: string, status: number, errors?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers: HeadersInit = {
    Accept: 'application/json',
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running?', 0);
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const err = (body ?? {}) as { message?: string; error?: string; errors?: Record<string, string[]> };
    const firstFieldError = err.errors ? Object.values(err.errors)[0]?.[0] : undefined;
    throw new ApiError(
      firstFieldError || err.message || err.error || response.statusText || 'Request failed',
      response.status,
      err.errors,
    );
  }

  return body as T;
}

function toQuery(params?: Record<string, string>): string {
  if (!params) return '';
  const qs = new URLSearchParams(params).toString();
  return qs ? `?${qs}` : '';
}

function upload<T>(path: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  return request<T>(path, { method: 'POST', body: formData });
}

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? 'Something went wrong');
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

export interface CaptchaChallenge {
  property_id: number;
  reference_no: string;
  challenge_id: string;
  /** data: URL of IESCO's CAPTCHA image */
  image: string;
}

export type CaptchaSubmitResult =
  | { status: 'success' | 'exists'; bill: Bill }
  | { status: 'captcha_invalid' | 'expired' | 'failed'; message: string };

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

export interface ImportResult {
  message?: string;
  [key: string]: unknown;
}

export interface MonthlyTrendPoint {
  amount: number;
  units: number | null;
}

export interface LocationTrend {
  location: { id: number; code: string };
  year: number;
  months: string[];
  totals: number[];
  units_totals: number[];
  properties: Array<{
    reference_no: string;
    name: string;
    property_type: string;
    monthly_data: Record<string, MonthlyTrendPoint | null>;
  }>;
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
  trend: (id: number | string, year: number) =>
    request<LocationTrend>(`/locations/${id}/trend?year=${year}`),
  import: (file: File) => upload<ImportResult>('/locations/import', file),
};

// Properties
export const properties = {
  list: (params?: Record<string, string>) =>
    request<Property[]>(`/properties${toQuery(params)}`),
  get: (id: number) => request<Property>(`/properties/${id}`),
  create: (data: Partial<Property>) =>
    request<Property>('/properties', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Property> & { reference_change_reason?: string }) =>
    request<Property>(`/properties/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<{ message: string }>(`/properties/${id}`, { method: 'DELETE' }),
  import: (file: File) => upload<ImportResult>('/properties/import', file),
  bulkUpdateRef: (file: File) => upload<ImportResult>('/properties/bulk-update-ref', file),
  bills: (id: number) => request<Bill[]>(`/properties/${id}/bills`),
  history: (id: number) => request<ReferenceHistory[]>(`/properties/${id}/history`),
};

// Bills
export const bills = {
  list: (params?: Record<string, string>) =>
    request<PaginatedResponse<Bill>>(`/bills${toQuery(params)}`),
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
  bulkProcess: (file: File) => upload<ImportResult>('/bills/bulk-process', file),
  import: (file: File) => upload<ImportResult>('/bills/import', file),
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
  bulkPdf: (ids: number[]) =>
    request<{ message: string; batch_id: number; bill_count: number }>('/bills/bulk-pdf', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  pdfBatchStatus: (batchId: number) =>
    request<{ batch_id: number; status: string; bill_count: number; pdf_path: string | null; error: string | null }>(`/pdf/${batchId}/status`),
  pdfBatchDownload: (batchId: number) => {
    window.open(`${API_BASE}/pdf/${batchId}/download`, '_blank');
  },
  export: (params?: Record<string, string>) => {
    window.open(`${API_BASE}/bills/export${toQuery(params)}`, '_blank');
  },
};

// Fetch
export const fetchApi = {
  start: (data?: { location_id?: number; property_type?: string; provider?: string }) =>
    request<{ batch_id: number; total_refs: number }>('/fetch', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
  single: (referenceNo: string, provider?: string) =>
    request<{ batch_id: number; total_refs: number }>('/fetch/single', {
      method: 'POST',
      body: JSON.stringify({ reference_no: referenceNo, provider: provider || 'iesco' }),
    }),
  latest: () => request<FetchBatch | null>('/fetch/latest'),
  captchaStart: (propertyId: number) =>
    request<CaptchaChallenge>('/fetch/captcha/start', {
      method: 'POST',
      body: JSON.stringify({ property_id: propertyId }),
    }),
  captchaSubmit: (propertyId: number, challengeId: string, answer: string) =>
    request<CaptchaSubmitResult>('/fetch/captcha/submit', {
      method: 'POST',
      body: JSON.stringify({ property_id: propertyId, challenge_id: challengeId, answer }),
    }),
  status: (id: number) => request<FetchBatch>(`/fetch/${id}/status`),
  results: (id: number) => request<Bill[]>(`/fetch/${id}/results`),
  download: (id: number) => {
    window.open(`${API_BASE}/fetch/${id}/download`, '_blank');
  },
};

// Payments
export const payments = {
  list: (params?: Record<string, string>) =>
    request<PaginatedResponse<PaymentProof>>(`/payments${toQuery(params)}`),
  upload: (file: File) => upload<ImportResult>('/payments/upload', file),
};

// Comparative
export interface ComparativeResult {
  reference_no: string;
  property_name: string | null;
  location: string | null;
  property_type: string;
  meter_no: string | null;
  error?: string;
  comparative: {
    current_month: string;
    prev_month: string;
    last_year_same_month: string;
    units: { current: number | null; prev: number | null; last_year: number | null };
    amount: { current: number | null; prev: number | null; last_year: number | null };
  };
}

export const comparative = {
  analyze: (referenceNumbers: string[]) =>
    request<ComparativeResult[]>('/comparative', {
      method: 'POST',
      body: JSON.stringify({ reference_numbers: referenceNumbers }),
    }),
};

// Dashboard
export const dashboard = {
  get: () => request<DashboardData>('/dashboard'),
};

// Logs
export const logs = {
  list: (params?: Record<string, string>) =>
    request<PaginatedResponse<LogEntry>>(`/logs${toQuery(params)}`),
};

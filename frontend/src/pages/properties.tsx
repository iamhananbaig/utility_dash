import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  properties as propertiesApi,
  locations as locationsApi,
  fetchApi,
  type Property,
} from '@/lib/api'
import { useQuery } from '@/hooks/use-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { notify } from '@/lib/notify'
import { confirmDialog } from '@/lib/confirm'
import { isAbortError, waitForBatch } from '@/lib/poll'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconUpload,
  IconSearch,
  IconCloudDownload,
} from '@tabler/icons-react'

export function PropertiesPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Property | null>(null)
  const [search, setSearch] = useState('')
  const [filterLocation, setFilterLocation] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterProvider, setFilterProvider] = useState('')
  const [fetchingId, setFetchingId] = useState<number | null>(null)
  const [form, setForm] = useState<{
    name: string
    reference_no: string
    provider: string
    meter_no: string
    location_id: string
    property_type: 'branch' | 'hostel'
    status: 'active' | 'inactive'
    notes: string
    reference_change_reason: string
  }>({
    name: '',
    reference_no: '',
    provider: 'iesco',
    meter_no: '',
    location_id: '',
    property_type: 'branch',
    status: 'active',
    notes: '',
    reference_change_reason: '',
  })
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const refUpdateInputRef = useRef<HTMLInputElement>(null)

  const debouncedSearch = useDebouncedValue(search.trim())
  const params: Record<string, string> = {}
  if (debouncedSearch) params.search = debouncedSearch
  if (filterLocation !== 'all') params.location_id = filterLocation
  if (filterStatus !== 'all') params.status = filterStatus
  if (filterProvider) params.provider = filterProvider
  const { data = [], loading, error, reload } = useQuery(`properties:${JSON.stringify(params)}`, () =>
    propertiesApi.list(params),
  )
  const { data: locationsList = [] } = useQuery('locations', () => locationsApi.list())

  // Abort in-flight fetch polling when leaving the page.
  const abortRef = useRef(new AbortController())
  useEffect(() => {
    const controller = new AbortController()
    abortRef.current = controller
    return () => controller.abort()
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({
      name: '',
      reference_no: '',
      provider: 'iesco',
      meter_no: '',
      location_id: '',
      property_type: 'branch',
      status: 'active',
      notes: '',
      reference_change_reason: '',
    })
    setDialogOpen(true)
  }

  const openEdit = (prop: Property) => {
    setEditing(prop)
    setForm({
      name: prop.name,
      reference_no: prop.reference_no,
      provider: prop.provider,
      meter_no: prop.meter_no || '',
      location_id: String(prop.location_id),
      property_type: prop.property_type,
      status: prop.status,
      notes: prop.notes || '',
      reference_change_reason: '',
    })
    setDialogOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        location_id: Number(form.location_id),
        meter_no: form.meter_no || null,
        notes: form.notes || null,
        provider: form.provider || 'iesco',
      }
      if (editing) {
        await propertiesApi.update(editing.id, payload)
      } else {
        await propertiesApi.create(payload)
      }
      setDialogOpen(false)
      notify.success(editing ? 'Property updated' : 'Property added')
      reload()
    } catch (err) {
      notify.error(err, 'Could not save property')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (prop: Property) => {
    const ok = await confirmDialog({
      title: `Delete ${prop.name}?`,
      description: `Reference ${prop.reference_no}. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    try {
      await propertiesApi.delete(prop.id)
      notify.success('Property deleted')
      reload()
    } catch (err) {
      notify.error(err, 'Could not delete property')
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await propertiesApi.import(file)
      notify.success('Import complete', result.message)
      reload()
    } catch (err) {
      notify.error(err, 'Import failed')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRefUpdate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await propertiesApi.bulkUpdateRef(file)
      notify.success('References updated', result.message)
      reload()
    } catch (err) {
      notify.error(err, 'Reference update failed')
    } finally {
      if (refUpdateInputRef.current) refUpdateInputRef.current.value = ''
    }
  }

  const handleFetchSingle = async (prop: Property) => {
    setFetchingId(prop.id)
    try {
      const response = await fetchApi.single(prop.reference_no, prop.provider)
      const batch = await waitForBatch(response.batch_id, { signal: abortRef.current.signal })
      if (batch.status === 'failed' || batch.fail_count > 0) {
        notify.warning('Fetch failed', `Could not fetch the bill for ${prop.reference_no}. See Logs for details.`)
      } else {
        notify.success('Bill fetched', `Bill saved for ${prop.reference_no}`)
      }
    } catch (err) {
      if (!isAbortError(err)) notify.error(err, 'Fetch failed')
    } finally {
      if (!abortRef.current.signal.aborted) setFetchingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Properties</h1>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImport}
          />
          <input
            ref={refUpdateInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleRefUpdate}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <IconUpload className="mr-2 h-4 w-4" />
            Import Excel
          </Button>
          <Button variant="outline" onClick={() => refUpdateInputRef.current?.click()}>
            <IconUpload className="mr-2 h-4 w-4" />
            Bulk Update Ref
          </Button>
          <a
            href="/samples/property_import_sample.xlsx"
            download
            className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
          >
            Download Import Template
          </a>
          <a
            href="/samples/bulk_ref_update_sample.xlsx"
            download
            className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
          >
            Download Ref Update Template
          </a>
          <Button onClick={openCreate}>
            <IconPlus className="mr-2 h-4 w-4" />
            Add Property
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, reference, meter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select items={[{ value: 'all', label: 'All Locations' }, ...locationsList.map((loc) => ({ value: String(loc.id), label: loc.code }))]} value={filterLocation} onValueChange={(v) => setFilterLocation(v ?? 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {locationsList.map((loc) => (
              <SelectItem key={loc.id} value={String(loc.id)}>
                {loc.code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={[{ value: 'all', label: 'All Status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} value={filterStatus} onValueChange={(v) => setFilterStatus(v ?? 'all')}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Provider (e.g. iesco)"
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
          className="w-36"
        />
      </div>

      {error && !loading ? (
        <p className="text-sm text-destructive">Could not load properties: {error.message}</p>
      ) : loading && data.length === 0 ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Reference No</TableHead>
                <TableHead>Meter No</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((prop) => (
                <TableRow key={prop.id}>
                  <TableCell>
                    <Link
                      to={`/properties/${prop.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {prop.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{prop.provider}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{prop.reference_no}</TableCell>
                  <TableCell className="font-mono text-sm">{prop.meter_no || '-'}</TableCell>
                  <TableCell>{prop.location?.code || '-'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{prop.property_type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={prop.status === 'active' ? 'default' : 'secondary'}>
                      {prop.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={fetchingId === prop.id}
                        onClick={() => handleFetchSingle(prop)}
                        title="Fetch bill"
                      >
                        <IconCloudDownload className={`h-4 w-4 ${fetchingId === prop.id ? 'animate-spin' : ''}`} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(prop)}>
                        <IconPencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(prop)}>
                        <IconTrash className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {data.length === 0 && (
                <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No properties found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Property' : 'Add Property'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. G9 Branch"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reference No</label>
              <Input
                value={form.reference_no}
                onChange={(e) => setForm({ ...form, reference_no: e.target.value })}
                placeholder="14-digit reference"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Provider</label>
              <Input
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="e.g. iesco, lesco"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Meter No</label>
              <Input
                value={form.meter_no}
                onChange={(e) => setForm({ ...form, meter_no: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Location</label>
              <Select items={[...locationsList.map((loc) => ({ value: String(loc.id), label: loc.code }))]}
                value={form.location_id}
                onValueChange={(v) => setForm({ ...form, location_id: v ?? '' })}
              >
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
            <div>
              <label className="text-sm font-medium">Property Type</label>
              <Select items={[{ value: 'branch', label: 'Branch' }, { value: 'hostel', label: 'Hostel' }]}
                value={form.property_type}
                onValueChange={(v) => setForm({ ...form, property_type: (v ?? 'branch') as 'branch' | 'hostel' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="branch">Branch</SelectItem>
                  <SelectItem value="hostel">Hostel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <Select items={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: (v ?? 'active') as 'active' | 'inactive' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium">Notes</label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional"
              />
            </div>
            {editing && (
              <div className="col-span-2">
                <label className="text-sm font-medium text-orange-600">
                  Reference Change Reason (if ref_no changed)
                </label>
                <Input
                  value={form.reference_change_reason}
                  onChange={(e) =>
                    setForm({ ...form, reference_change_reason: e.target.value })
                  }
                  placeholder="Why was the reference number changed?"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

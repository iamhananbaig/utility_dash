import { useState, useRef } from 'react'
import { locations as locationsApi, type Location } from '@/lib/api'
import { useQuery } from '@/hooks/use-query'
import { notify } from '@/lib/notify'
import { confirmDialog } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { IconPlus, IconPencil, IconTrash, IconUpload } from '@tabler/icons-react'

export function LocationsPage() {
  const { data = [], loading, error, reload } = useQuery('locations', () => locationsApi.list())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Location | null>(null)
  const [form, setForm] = useState({ code: '', city: '' })
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const openCreate = () => {
    setEditing(null)
    setForm({ code: '', city: '' })
    setDialogOpen(true)
  }

  const openEdit = (loc: Location) => {
    setEditing(loc)
    setForm({ code: loc.code, city: loc.city })
    setDialogOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = { ...form }
      if (editing) {
        await locationsApi.update(editing.id, payload)
      } else {
        await locationsApi.create(payload)
      }
      setDialogOpen(false)
      notify.success(editing ? 'Location updated' : 'Location added')
      reload()
    } catch (err) {
      notify.error(err, 'Could not save location')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (loc: Location) => {
    const ok = await confirmDialog({
      title: `Delete location ${loc.code}?`,
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    try {
      await locationsApi.delete(loc.id)
      notify.success('Location deleted')
      reload()
    } catch (err) {
      notify.error(err, 'Could not delete location')
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await locationsApi.import(file)
      notify.success('Import complete', result.message)
      reload()
    } catch (err) {
      notify.error(err, 'Import failed')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Locations</h1>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImport}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <IconUpload className="mr-2 h-4 w-4" />
            Import Excel
          </Button>
          <a
            href="/samples/location_import_sample.xlsx"
            download
            className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
          >
            Download Template
          </a>
          <Button onClick={openCreate}>
            <IconPlus className="mr-2 h-4 w-4" />
            Add Location
          </Button>
        </div>
      </div>

      {error && !loading ? (
        <p className="text-sm text-destructive">Could not load locations: {error.message}</p>
      ) : loading && data.length === 0 ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Properties</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((loc) => (
                <TableRow key={loc.id}>
                  <TableCell className="font-mono font-medium">{loc.code}</TableCell>
                  <TableCell>{loc.city}</TableCell>
                  <TableCell>{loc.properties_count}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(loc)}>
                        <IconPencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(loc)}>
                        <IconTrash className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No locations yet. Add one to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Location' : 'Add Location'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Code</label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. G9, ABT"
              />
            </div>
            <div>
              <label className="text-sm font-medium">City</label>
              <Input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="e.g. Islamabad"
              />
            </div>
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

export { cn } from "cn"

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const day = String(d.getDate()).padStart(2, '0')
    const month = MONTHS[d.getMonth()]
    const year = String(d.getFullYear()).slice(-2)
    return `${day}-${month}-${year}`
  } catch {
    return dateStr
  }
}

export function formatBillMonth(month: string | null | undefined): string {
  if (!month) return '-'
  // bill_month is stored as "MMM YY" (e.g., "SEP 25")
  // Display as "MMM YY" (e.g., "Sep 25")
  const parts = month.trim().split(/\s+/)
  if (parts.length === 2) {
    const mon = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()
    const yy = parts[1].slice(-2)
    return `${mon} ${yy}`
  }
  return month
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const day = String(d.getDate()).padStart(2, '0')
    const month = MONTHS[d.getMonth()]
    const year = String(d.getFullYear()).slice(-2)
    const hours = String(d.getHours()).padStart(2, '0')
    const mins = String(d.getMinutes()).padStart(2, '0')
    return `${day}-${month}-${year} ${hours}:${mins}`
  } catch {
    return dateStr
  }
}

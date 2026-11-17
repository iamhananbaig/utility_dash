export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

let current: PendingConfirm | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export const confirmStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: () => current,
  settle(ok: boolean) {
    current?.resolve(ok)
    current = null
    emit()
  },
}

/**
 * Promise-based replacement for window.confirm(), rendered with the app's
 * AlertDialog. Requires <ConfirmDialogHost /> to be mounted once.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  current?.resolve(false)
  return new Promise((resolve) => {
    current = { ...options, resolve }
    emit()
  })
}

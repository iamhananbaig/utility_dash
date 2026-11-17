import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/api"

/** App-wide toast helpers. Replaces blocking window.alert() calls. */
export const notify = {
  success(title: string, description?: string) {
    toast.add({ title, description, type: "success" })
  },
  info(title: string, description?: string) {
    toast.add({ title, description, type: "info" })
  },
  warning(title: string, description?: string) {
    toast.add({ title, description, type: "warning" })
  },
  error(error: unknown, title = "Something went wrong") {
    toast.add({ title, description: errorMessage(error), type: "error" })
  },
}

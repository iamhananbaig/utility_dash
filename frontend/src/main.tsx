import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { Toaster } from "@/components/ui/toast"
import { ConfirmDialogHost } from "@/components/confirm-dialog-host"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <Toaster>
        <App />
        <ConfirmDialogHost />
      </Toaster>
    </ThemeProvider>
  </StrictMode>
)

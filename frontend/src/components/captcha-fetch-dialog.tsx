import { useState } from "react"
import { IconCheck, IconPlayerSkipForward, IconRefresh, IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { useQuery } from "@/hooks/use-query"
import { errorMessage, fetchApi, type Bill, type Property } from "@/lib/api"
import { notify } from "@/lib/notify"

type Outcome = "saved" | "existed" | "failed" | "skipped"

interface ResultEntry {
  property: Property
  outcome: Outcome
  message?: string
  bill?: Bill
}

interface CaptchaFetchDialogProps {
  properties: Property[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the dialog closes with everything that was attempted. */
  onFinished?: (results: ResultEntry[]) => void
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  saved: "Saved",
  existed: "Already had this month",
  failed: "Failed",
  skipped: "Skipped",
}

/**
 * Fetches IESCO bills one property at a time. IESCO requires a CAPTCHA per
 * lookup, so a person reads each image and types the code; everything else
 * (parsing, saving, logging) is automatic.
 *
 * Mount with a fresh `key` per run so state starts clean.
 */
export function CaptchaFetchDialog({ properties, open, onOpenChange, onFinished }: CaptchaFetchDialogProps) {
  const [index, setIndex] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [answer, setAnswer] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<ResultEntry[]>([])

  const current = properties[index]
  const done = index >= properties.length

  const {
    data: challenge,
    loading: loadingImage,
    error: imageError,
    reload,
  } = useQuery(open && current ? `captcha:${current.id}:${attempt}` : null, () =>
    fetchApi.captchaStart(current.id),
  )
  // Never show the previous property's image while the next one loads.
  const image = challenge && challenge.property_id === current?.id && !loadingImage ? challenge : null

  const record = (entry: ResultEntry) => {
    setResults((prev) => [...prev, entry])
    setAnswer("")
    setAttempt(0)
    setIndex((i) => i + 1)
  }

  const newImage = () => {
    setAnswer("")
    setAttempt((a) => a + 1)
  }

  const submit = async () => {
    if (!image || !current || !answer.trim() || submitting) return
    setSubmitting(true)
    try {
      const result = await fetchApi.captchaSubmit(current.id, image.challenge_id, answer.trim())
      switch (result.status) {
        case "success":
          record({ property: current, outcome: "saved", bill: result.bill })
          break
        case "exists":
          record({ property: current, outcome: "existed", bill: result.bill })
          break
        case "captcha_invalid":
        case "expired":
          notify.warning(result.message)
          newImage()
          break
        case "failed":
          record({ property: current, outcome: "failed", message: result.message })
          break
      }
    } catch (err) {
      notify.error(err, "Could not submit the CAPTCHA")
      newImage()
    } finally {
      setSubmitting(false)
    }
  }

  const close = () => {
    onOpenChange(false)
    onFinished?.(results)
  }

  const count = (outcome: Outcome) => results.filter((r) => r.outcome === outcome).length

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{done ? "Fetch finished" : "Fetch with CAPTCHA"}</DialogTitle>
          <DialogDescription>
            {done
              ? `${count("saved")} saved, ${count("existed")} already existed, ${count("failed")} failed, ${count("skipped")} skipped.`
              : "IESCO asks for a CAPTCHA on every bill lookup. Type the code shown to fetch this bill."}
          </DialogDescription>
        </DialogHeader>

        {!done && current && (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{current.name}</span>
                <span className="text-muted-foreground">
                  {index + 1} of {properties.length}
                </span>
              </div>
              <p className="font-mono text-xs text-muted-foreground">{current.reference_no}</p>
              <Progress value={(index / properties.length) * 100} className="h-1.5" />
            </div>

            <div className="flex h-[90px] items-center justify-center rounded-md border bg-white">
              {image ? (
                <img
                  src={image.image}
                  alt={`CAPTCHA for reference ${current.reference_no}`}
                  className="h-[90px] w-[300px] object-contain"
                />
              ) : imageError && !loadingImage ? (
                <p className="px-3 text-center text-sm text-destructive">{errorMessage(imageError)}</p>
              ) : (
                <p className="text-sm text-neutral-500">Loading CAPTCHA…</p>
              )}
            </div>

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <Input
                autoFocus
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type the code"
                maxLength={10}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                disabled={!image || submitting}
                aria-label="CAPTCHA code"
                className="font-mono tracking-widest"
              />
              <Button type="submit" disabled={!image || !answer.trim() || submitting}>
                {submitting ? "Fetching…" : "Fetch"}
              </Button>
            </form>

            <div className="flex justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={imageError ? reload : newImage}
                disabled={loadingImage || submitting}
              >
                <IconRefresh className="mr-1 h-3.5 w-3.5" />
                New image
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => record({ property: current, outcome: "skipped" })}
                disabled={submitting}
              >
                <IconPlayerSkipForward className="mr-1 h-3.5 w-3.5" />
                Skip
              </Button>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto border-t pt-3 text-xs">
            {results.map((r) => (
              <li key={r.property.id} className="flex items-start gap-2">
                {r.outcome === "saved" || r.outcome === "existed" ? (
                  <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                ) : (
                  <IconX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="font-medium">{r.property.name}</span>{" "}
                  <span className="text-muted-foreground">
                    — {OUTCOME_LABEL[r.outcome]}
                    {r.bill?.bill_month ? ` (${r.bill.bill_month})` : ""}
                    {r.message ? `: ${r.message}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant={done ? "default" : "outline"} onClick={close} disabled={submitting}>
            {done ? "Done" : "Stop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

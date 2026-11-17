import { fetchApi, type FetchBatch } from "@/lib/api"

interface PollOptions<T> {
  onProgress?: (value: T) => void
  signal?: AbortSignal
  intervalMs?: number
  /** Consecutive request failures tolerated before giving up. */
  maxErrors?: number
  /** Give up after this long, even if the operation still reports "running". */
  timeoutMs?: number
  timeoutMessage?: string
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/**
 * Call `fn` every `intervalMs` until `isDone(result)` is true. Survives
 * transient errors, stops on abort (e.g. component unmount) and never loops
 * forever.
 */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  isDone: (value: T) => boolean,
  {
    onProgress,
    signal,
    intervalMs = 2000,
    maxErrors = 5,
    timeoutMs = 30 * 60_000,
    timeoutMessage = "Timed out waiting for the operation to finish.",
  }: PollOptions<T> = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let errors = 0

  for (;;) {
    try {
      const value = await fn()
      errors = 0
      onProgress?.(value)
      if (isDone(value)) return value
    } catch (err) {
      if (++errors >= maxErrors) throw err
    }
    if (Date.now() > deadline) throw new Error(timeoutMessage)
    await sleep(intervalMs, signal)
  }
}

const TERMINAL: FetchBatch["status"][] = ["completed", "failed"]

/** Poll a fetch batch until it completes or fails. */
export function waitForBatch(
  batchId: number,
  options: Omit<PollOptions<FetchBatch>, "timeoutMessage"> = {},
): Promise<FetchBatch> {
  return pollUntil(
    () => fetchApi.status(batchId),
    (batch) => TERMINAL.includes(batch.status),
    { ...options, timeoutMessage: "Timed out waiting for the fetch to finish. Check the Logs page." },
  )
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError"
}

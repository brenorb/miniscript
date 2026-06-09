export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object') {
    const message = readObjectMessage(error)
    if (message) {
      return message
    }

    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }

  return String(error)
}

function readObjectMessage(value: object): string | null {
  for (const key of ['message', 'reason', 'detail', 'error']) {
    const candidate = (value as Record<string, unknown>)[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate
    }
  }

  return null
}

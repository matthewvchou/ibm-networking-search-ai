export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === 'not-found') return 'Employee not found.'
    if (err.message === 'unavailable') return 'Directory service unavailable.'
    if (err.message === 'timeout')
      return 'That search took too long. Try a more specific name or job title.'
    return err.message
  }
  return 'Something went wrong.'
}

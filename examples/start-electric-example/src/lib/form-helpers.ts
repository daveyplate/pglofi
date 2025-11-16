export function handleAction<T extends {}>(
  action: (values: T) => Promise<unknown> | unknown
) {
  return async (formData: FormData) => {
    const values = Object.fromEntries(formData.entries()) as T
    await action(values)
  }
}

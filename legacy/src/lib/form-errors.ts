import { useState } from 'react'
import { z } from 'zod'
import { ApiRequestError, errorMessage } from './api'

type FieldErrors = Record<string, string | undefined>

/**
 * Error state for small forms: validate with the same zod schema the server uses, then map
 * either local or API errors onto fields, with anything else as one form-level message.
 */
export function useFormErrors() {
  const [fields, setFields] = useState<FieldErrors>({})
  const [form, setForm] = useState<string | null>(null)

  function validate<T extends z.ZodType>(schema: T, values: unknown): z.infer<T> | null {
    const result = schema.safeParse(values)
    if (result.success) {
      setFields({})
      setForm(null)
      return result.data
    }
    const flat = z.flattenError(result.error)
    setFields(Object.fromEntries(Object.entries(flat.fieldErrors).map(([k, v]) => [k, (v as string[] | undefined)?.[0]])))
    setForm(flat.formErrors[0] ?? null)
    return null
  }

  function fromError(err: unknown) {
    if (err instanceof ApiRequestError && Object.keys(err.fields).length > 0) {
      setFields(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v?.[0]])))
      setForm(null)
    } else {
      setForm(errorMessage(err))
    }
  }

  return { fields, form, validate, fromError, clear: () => (setFields({}), setForm(null)) }
}

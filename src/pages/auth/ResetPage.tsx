import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { Me } from '@shared/api'
import { password as passwordSchema } from '@shared/auth'
import { z } from 'zod'
import { Field, FormError } from '@/components/common/Field'
import { AuthHeading } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useFormErrors } from '@/lib/form-errors'

const schema = z.object({ password: passwordSchema })

export default function ResetPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const errors = useFormErrors()
  const [password, setPassword] = useState('')

  const reset = useMutation({
    mutationFn: (input: { password: string }) => api<Me>('/api/auth/reset', { method: 'POST', body: { token, ...input } }),
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me)
      navigate('/dashboard', { replace: true })
    },
    onError: errors.fromError,
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(schema, { password })
    if (input) reset.mutate(input)
  }

  return (
    <>
      <AuthHeading title="Choose a new password">You’ll be signed out on every other device.</AuthHeading>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormError message={errors.form} />
        <Field label="New password" description="At least 8 characters" error={errors.fields.password}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" disabled={reset.isPending}>{reset.isPending ? 'Saving…' : 'Save password'}</Button>
      </form>
    </>
  )
}

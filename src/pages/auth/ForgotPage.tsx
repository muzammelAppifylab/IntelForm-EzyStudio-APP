import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { forgotInput } from '@shared/auth'
import { Field, FormError } from '@/components/common/Field'
import { AuthHeading } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useFormErrors } from '@/lib/form-errors'

export default function ForgotPage() {
  const errors = useFormErrors()
  const [email, setEmail] = useState('')
  const forgot = useMutation({
    mutationFn: (input: { email: string }) => api('/api/auth/forgot', { method: 'POST', body: input }),
    onError: errors.fromError,
  })

  if (forgot.isSuccess) {
    return (
      <>
        <AuthHeading title="Check your email">
          If that address belongs to a team member, a reset link is on its way. It works for 60 minutes.
        </AuthHeading>
        <Button asChild variant="outline" className="w-full"><Link to="/login">Back to log in</Link></Button>
      </>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(forgotInput, { email })
    if (input) forgot.mutate(input)
  }

  return (
    <>
      <AuthHeading title="Reset your password">Enter your email and we’ll send you a link to choose a new password.</AuthHeading>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormError message={errors.form} />
        <Field label="Email" error={errors.fields.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Button type="submit" disabled={forgot.isPending}>{forgot.isPending ? 'Sending…' : 'Send reset link'}</Button>
        <Link to="/login" className="justify-self-center text-body-sm text-link underline underline-offset-4 hover:decoration-2">Back to log in</Link>
      </form>
    </>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import type { Me } from '@shared/api'
import { loginInput, type LoginInput } from '@shared/auth'
import { Field, FormError } from '@/components/common/Field'
import { AuthHeading } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { appInfoQuery, setupStatusQuery } from '@/lib/auth'
import { useFormErrors } from '@/lib/form-errors'

/** Only dashboard paths are allowed as a post-login target (no open redirects). */
function safeNext(next: string | null) {
  return next && next.startsWith('/dashboard') ? next : '/dashboard'
}

export default function LoginPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const status = useQuery(setupStatusQuery)
  const { data: app } = useQuery(appInfoQuery)
  const errors = useFormErrors()
  const [values, setValues] = useState<LoginInput>({ email: '', password: '' })

  const login = useMutation({
    mutationFn: (input: LoginInput) => api<Me>('/api/auth/login', { method: 'POST', body: input }),
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me)
      navigate(safeNext(params.get('next')), { replace: true })
    },
    onError: errors.fromError,
  })

  if (status.data?.needsSetup) return <Navigate to="/setup" replace />

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(loginInput, values)
    if (input) login.mutate(input)
  }

  return (
    <>
      <AuthHeading title="Log in" />
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormError message={errors.form} />
        <Field label="Email" error={errors.fields.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus value={values.email} onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} />}
        </Field>
        <Field label="Password" error={errors.fields.password}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" value={values.password} onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} />}
        </Field>
        {app?.emailEnabled && (
          <Link to="/forgot" className="justify-self-start text-body-sm text-link underline underline-offset-4 hover:decoration-2">
            Forgot password?
          </Link>
        )}
        <Button type="submit" disabled={login.isPending} className="mt-2">
          {login.isPending ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      {app && !app.emailEnabled && (
        <p className="mt-6 text-caption text-muted-foreground">Forgot your password? Ask the Owner to set a new one for you.</p>
      )}
    </>
  )
}

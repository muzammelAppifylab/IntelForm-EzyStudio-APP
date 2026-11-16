import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import type { Me } from '@shared/api'
import { setupInput, type SetupInput } from '@shared/auth'
import { Field, FormError } from '@/components/common/Field'
import { AuthHeading } from '@/components/layout/AuthLayout'
import { FullPageSpinner } from '@/components/layout/FullPageSpinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { setupStatusQuery } from '@/lib/auth'
import { useFormErrors } from '@/lib/form-errors'

const withToken = setupInput.refine((v) => !!v.setupToken, {
  message: 'Enter the setup token from SETUP_TOKEN in the server’s environment',
  path: ['setupToken'],
})

/** First-run setup: shown once on a fresh install, creates the Owner. */
export default function SetupPage() {
  const status = useQuery(setupStatusQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const errors = useFormErrors()
  const [values, setValues] = useState<SetupInput>({ name: '', email: '', password: '', appName: 'IntelForm', setupToken: '' })

  const setup = useMutation({
    mutationFn: (input: SetupInput) => api<Me>('/api/setup', { method: 'POST', body: input }),
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me)
      queryClient.invalidateQueries({ queryKey: ['app-info'] })
      navigate('/dashboard', { replace: true })
    },
    onError: errors.fromError,
  })

  if (status.isPending) return <FullPageSpinner />
  if (status.data && !status.data.needsSetup) return <Navigate to="/login" replace />
  const tokenRequired = !!status.data?.tokenRequired

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(tokenRequired ? withToken : setupInput, values)
    if (input) setup.mutate(tokenRequired ? input : { ...input, setupToken: undefined })
  }
  const set = (key: keyof SetupInput) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: e.target.value }))

  return (
    <>
      <AuthHeading title="Set up your app">
        You’ll be the Owner. After this, people join only when you invite them.
      </AuthHeading>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormError message={errors.form} />
        {tokenRequired && (
          <Field label="Setup token" description="Your server requires it. Copy the value of SETUP_TOKEN from the server’s environment." error={errors.fields.setupToken} required>
            {(p) => <Input {...p} autoComplete="off" spellCheck={false} className="font-mono" value={values.setupToken ?? ''} onChange={set('setupToken')} />}
          </Field>
        )}
        <Field label="Your name" error={errors.fields.name} required>
          {(p) => <Input {...p} autoComplete="name" value={values.name} onChange={set('name')} />}
        </Field>
        <Field label="Email" error={errors.fields.email} required>
          {(p) => <Input {...p} type="email" autoComplete="email" value={values.email} onChange={set('email')} />}
        </Field>
        <Field label="Password" description="At least 8 characters" error={errors.fields.password} required>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={values.password} onChange={set('password')} />}
        </Field>
        <Field label="App name" description="Shown on the login screen and in emails. You can change it later." error={errors.fields.appName} required>
          {(p) => <Input {...p} value={values.appName} onChange={set('appName')} />}
        </Field>
        <Button type="submit" disabled={setup.isPending} className="mt-2">
          {setup.isPending ? 'Setting up…' : 'Create Owner account'}
        </Button>
      </form>
    </>
  )
}

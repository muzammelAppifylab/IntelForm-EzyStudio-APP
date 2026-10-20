import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { InviteInfo, Me } from '@shared/api'
import { acceptInviteInput } from '@shared/auth'
import { ROLE_LABEL } from '@shared/roles'
import { Field, FormError } from '@/components/common/Field'
import { AuthHeading } from '@/components/layout/AuthLayout'
import { FullPageSpinner } from '@/components/layout/FullPageSpinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'
import { useFormErrors } from '@/lib/form-errors'

/** Accept invite: set name and password, then land in the dashboard. */
export default function InvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const errors = useFormErrors()
  const [values, setValues] = useState({ name: '', password: '' })

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`),
    retry: false,
  })
  const accept = useMutation({
    mutationFn: (input: { name: string; password: string }) =>
      api<Me>(`/api/invites/${encodeURIComponent(token)}/accept`, { method: 'POST', body: input }),
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me)
      navigate('/dashboard', { replace: true })
    },
    onError: errors.fromError,
  })

  if (invite.isPending) return <FullPageSpinner />
  if (invite.isError) {
    return (
      <>
        <AuthHeading title="This invite can’t be used">{errorMessage(invite.error)}</AuthHeading>
        <Button asChild variant="outline" className="w-full"><Link to="/login">Go to log in</Link></Button>
      </>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(acceptInviteInput, values)
    if (input) accept.mutate(input)
  }

  return (
    <>
      <AuthHeading title={`Join ${invite.data.appName}`}>
        {`You’re invited as ${ROLE_LABEL[invite.data.role] === 'Editor' ? 'an Editor' : 'a Viewer'}. Set your name and password to finish.`}
      </AuthHeading>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormError message={errors.form} />
        <Field label="Email">
          {(p) => <Input {...p} value={invite.data.email} readOnly disabled />}
        </Field>
        <Field label="Your name" error={errors.fields.name} required>
          {(p) => <Input {...p} autoComplete="name" autoFocus value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />}
        </Field>
        <Field label="Password" description="At least 8 characters" error={errors.fields.password} required>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={values.password} onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} />}
        </Field>
        <Button type="submit" disabled={accept.isPending} className="mt-2">{accept.isPending ? 'Joining…' : 'Join the team'}</Button>
      </form>
    </>
  )
}

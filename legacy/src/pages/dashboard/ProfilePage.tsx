import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import type { Me } from '@shared/api'
import { profileInput, type ProfileInput } from '@shared/auth'
import { ROLE_LABEL } from '@shared/roles'
import { Field, FormError } from '@/components/common/Field'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useMe } from '@/lib/auth'
import { useFormErrors } from '@/lib/form-errors'
import { errorMessage } from '@/lib/api'
import { ImageUpload } from '@/pages/dashboard/settings/ImageUpload'

function useSaveProfile(onDone: () => void, errors: ReturnType<typeof useFormErrors>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ProfileInput) => api<Me>('/api/me', { method: 'PATCH', body: input }),
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me)
      queryClient.invalidateQueries({ queryKey: ['team'] })
      onDone()
    },
    onError: errors.fromError,
  })
}

export default function ProfilePage() {
  const me = useMe()
  return (
    <>
      <PageHeader title="Profile" description={`You’re ${me.role === 'owner' ? 'the' : 'an'} ${ROLE_LABEL[me.role]} on this team.`} />
      <div className="grid max-w-2xl gap-6">
        <AvatarCard />
        <DetailsCard />
        <PasswordCard />
      </div>
    </>
  )
}

/**
 * Profile photo: uploaded with purpose "avatar", then saved with PATCH /api/me { avatarUrl }.
 * Shown beside the member's name in the team list and the sidebar menu.
 */
function AvatarCard() {
  const me = useMe()
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (avatarUrl: string | null) => api<Me>('/api/me', { method: 'PATCH', body: { avatarUrl } }),
    onSuccess: (next, avatarUrl) => {
      if ((next.avatarUrl ?? null) !== avatarUrl) {
        toast.error('Your photo couldn’t be saved. Try again later.')
        return
      }
      queryClient.setQueryData(['me'], next)
      queryClient.invalidateQueries({ queryKey: ['team'] })
      toast.success(avatarUrl ? 'Photo saved' : 'Photo removed')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-subheading">Photo</CardTitle>
        <CardDescription>Shown next to your name in the team list. Without one, your initials are used.</CardDescription>
      </CardHeader>
      <CardContent>
        <ImageUpload
          label="Profile photo"
          description="A square JPG, PNG or WebP image works best, up to 5 MB."
          purpose="avatar"
          shape="round"
          value={me.avatarUrl}
          disabled={save.isPending}
          onChange={(url) => save.mutate(url)}
        />
      </CardContent>
    </Card>
  )
}

function DetailsCard() {
  const me = useMe()
  const errors = useFormErrors()
  const [values, setValues] = useState({ name: me.name, email: me.email, currentPassword: '' })
  const emailChanged = values.email.trim().toLowerCase() !== me.email
  const save = useSaveProfile(() => {
    setValues((v) => ({ ...v, currentPassword: '' }))
    toast.success('Profile saved')
  }, errors)

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(profileInput, {
      name: values.name,
      email: emailChanged ? values.email : undefined,
      currentPassword: emailChanged ? values.currentPassword : undefined,
    })
    if (input) save.mutate(input)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-subheading">Your details</CardTitle>
        <CardDescription>Your teammates see your name next to the forms you edit.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <FormError message={errors.form} />
          <Field label="Name" error={errors.fields.name}>
            {(p) => <Input {...p} autoComplete="name" value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />}
          </Field>
          <Field label="Email" description="You log in with this address." error={errors.fields.email}>
            {(p) => <Input {...p} type="email" autoComplete="email" value={values.email} onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} />}
          </Field>
          {emailChanged && (
            <Field label="Current password" description="Needed to change your email." error={errors.fields.currentPassword}>
              {(p) => <Input {...p} type="password" autoComplete="current-password" value={values.currentPassword} onChange={(e) => setValues((v) => ({ ...v, currentPassword: e.target.value }))} />}
            </Field>
          )}
          <Button type="submit" disabled={save.isPending} className="justify-self-start">Save details</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PasswordCard() {
  const errors = useFormErrors()
  const [values, setValues] = useState({ currentPassword: '', newPassword: '' })
  const save = useSaveProfile(() => {
    setValues({ currentPassword: '', newPassword: '' })
    toast.success('Password changed')
  }, errors)

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(profileInput, { currentPassword: values.currentPassword, newPassword: values.newPassword })
    if (input) save.mutate(input)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-subheading">Password</CardTitle>
        <CardDescription>Changing it signs you out on every other device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <FormError message={errors.form} />
          <Field label="Current password" error={errors.fields.currentPassword}>
            {(p) => <Input {...p} type="password" autoComplete="current-password" value={values.currentPassword} onChange={(e) => setValues((v) => ({ ...v, currentPassword: e.target.value }))} />}
          </Field>
          <Field label="New password" description="At least 8 characters" error={errors.fields.newPassword}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" value={values.newPassword} onChange={(e) => setValues((v) => ({ ...v, newPassword: e.target.value }))} />}
          </Field>
          <Button type="submit" disabled={save.isPending} className="justify-self-start">Change password</Button>
        </form>
      </CardContent>
    </Card>
  )
}

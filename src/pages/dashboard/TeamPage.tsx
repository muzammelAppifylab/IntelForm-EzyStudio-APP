import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, MoreHorizontal, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import type { CreatedInvite, PendingInvite, TeamMember, TeamResponse } from '@shared/api'
import { inviteInput, password as passwordSchema, type InviteInput } from '@shared/auth'
import { ROLE_LABEL, type InvitableRole } from '@shared/roles'
import { Field, FormError } from '@/components/common/Field'
import { PageHeader } from '@/components/common/PageHeader'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useCan, useMe } from '@/lib/auth'
import { useFormErrors } from '@/lib/form-errors'
import { initials } from '@/lib/utils'

const teamQuery = { queryKey: ['team'], queryFn: () => api<TeamResponse>('/api/team') }

type Dialogs =
  | { kind: 'invite' }
  | { kind: 'link'; created: CreatedInvite }
  | { kind: 'password'; member: TeamMember }
  | { kind: 'remove'; member: TeamMember }
  | { kind: 'transfer'; member: TeamMember }
  | null

export default function TeamPage() {
  const canManage = useCan('team.manage')
  const team = useQuery(teamQuery)
  const [dialog, setDialog] = useState<Dialogs>(null)

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone here can open the dashboard. Editors build and publish forms; Viewers can read forms and responses and export CSV."
        actions={canManage && <Button onClick={() => setDialog({ kind: 'invite' })}><UserPlus aria-hidden /> Invite member</Button>}
      />

      <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="members-heading">
        <h2 id="members-heading" className="sr-only">Members</h2>
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">Joined</TableHead>
              {canManage && <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.isPending &&
              Array.from({ length: 3 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={canManage ? 4 : 3}><Skeleton className="h-8 w-full" /></TableCell>
                </TableRow>
              ))}
            {team.isError && (
              <TableRow>
                <TableCell colSpan={canManage ? 4 : 3} className="py-8 text-center text-muted-foreground">
                  {errorMessage(team.error)} <Button variant="link" onClick={() => team.refetch()}>Try again</Button>
                </TableCell>
              </TableRow>
            )}
            {team.data?.members.map((m) => (
              <MemberRow key={m.id} member={m} canManage={canManage} onAction={setDialog} />
            ))}
          </TableBody>
        </Table>
      </section>

      {canManage && team.data && team.data.invites.length > 0 && <PendingInvites invites={team.data.invites} onResend={(created) => setDialog({ kind: 'link', created })} />}

      {dialog?.kind === 'invite' && <InviteDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'link' && <InviteLinkDialog created={dialog.created} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'password' && <SetPasswordDialog member={dialog.member} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'remove' && <RemoveDialog member={dialog.member} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'transfer' && <TransferDialog member={dialog.member} onClose={() => setDialog(null)} />}
    </>
  )
}

function MemberRow({ member, canManage, onAction }: { member: TeamMember; canManage: boolean; onAction: (d: Dialogs) => void }) {
  const me = useMe()
  const queryClient = useQueryClient()
  const changeRole = useMutation({
    mutationFn: (role: InvitableRole) => api(`/api/team/${member.id}`, { method: 'PATCH', body: { role } }),
    onSuccess: (_, role) => {
      toast.success(`${member.name} is now ${role === 'editor' ? 'an Editor' : 'a Viewer'}`)
      queryClient.invalidateQueries({ queryKey: ['team'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const isSelf = member.id === me.id
  const otherRole: InvitableRole = member.role === 'editor' ? 'viewer' : 'editor'

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
            <AvatarFallback className="bg-accent text-caption font-semibold text-accent-foreground">{initials(member.name)}</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0">
            <span className="truncate text-label">{member.name}{isSelf && <span className="text-muted-foreground"> (you)</span>}</span>
            <span className="truncate text-caption text-muted-foreground">{member.email}</span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>{ROLE_LABEL[member.role]}</Badge>
      </TableCell>
      <TableCell className="hidden text-body-sm text-muted-foreground tabular sm:table-cell">
        {new Date(member.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
      </TableCell>
      {canManage && (
        <TableCell>
          {member.role !== 'owner' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.name}`}><MoreHorizontal aria-hidden /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => changeRole.mutate(otherRole)}>Make {ROLE_LABEL[otherRole]}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction({ kind: 'password', member })}>Set new password</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction({ kind: 'transfer', member })}>Transfer ownership</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onAction({ kind: 'remove', member })}>Remove from team</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </TableCell>
      )}
    </TableRow>
  )
}

function PendingInvites({ invites, onResend }: { invites: PendingInvite[]; onResend: (created: CreatedInvite) => void }) {
  const queryClient = useQueryClient()
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Invite revoked')
      queryClient.invalidateQueries({ queryKey: ['team'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  // Links are stored hashed, so "New link" re-invites, which replaces the old link.
  const resend = useMutation({
    mutationFn: (i: PendingInvite) => api<CreatedInvite>('/api/invites', { method: 'POST', body: { email: i.email, role: i.role } }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['team'] })
      onResend(created)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <section className="grid gap-3" aria-labelledby="invites-heading">
      <h2 id="invites-heading" className="text-subheading">Pending invites</h2>
      <ul className="divide-y rounded-lg border bg-card">
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="grid min-w-0 flex-1">
              <span className="truncate text-label">{i.email}</span>
              <span className="text-caption text-muted-foreground">
                {ROLE_LABEL[i.role]} · link expires {new Date(i.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => resend.mutate(i)} disabled={resend.isPending}>New link</Button>
            <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)} disabled={revoke.isPending}>Revoke</Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One dialog for both steps, so the form and the link never animate over each other. */
function InviteDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const errors = useFormErrors()
  const [values, setValues] = useState<InviteInput>({ email: '', role: 'editor' })
  const invite = useMutation({
    mutationFn: (input: InviteInput) => api<CreatedInvite>('/api/invites', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
    onError: errors.fromError,
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(inviteInput, values)
    if (input) invite.mutate(input)
  }

  if (invite.data) return <InviteLinkDialog created={invite.data} onClose={onClose} />

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>They get a link to set their name and password. It works for 7 days.</DialogDescription>
          </DialogHeader>
          <FormError message={errors.form} />
          <Field label="Email" error={errors.fields.email}>
            {(p) => <Input {...p} type="email" autoFocus value={values.email} onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} />}
          </Field>
          <Field label="Role" error={errors.fields.role}>
            {(p) => (
              <Select value={values.role} onValueChange={(role) => setValues((v) => ({ ...v, role: role as InvitableRole }))}>
                <SelectTrigger {...p} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor: builds, publishes and deletes forms</SelectItem>
                  <SelectItem value="viewer">Viewer: reads forms and responses</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={invite.isPending}>{invite.isPending ? 'Creating…' : 'Create invite'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InviteLinkDialog({ created, onClose }: { created: CreatedInvite; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(created.link)
      setCopied(true)
      toast.success('Link copied')
    } catch {
      toast.error('Couldn’t copy. Select the link and copy it yourself.')
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite ready</DialogTitle>
          <DialogDescription>
            {created.emailed
              ? `We emailed ${created.invite.email}. You can also send them this link yourself.`
              : `Email isn’t set up yet, so send ${created.invite.email} this link yourself. It works for 7 days and is shown only once.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={created.link} className="font-mono text-body-sm" onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <Button variant="outline" onClick={copy}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />} Copy</Button>
        </div>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const setPasswordInput = z.object({
  password: passwordSchema,
  currentPassword: z.string().min(1, 'Enter your password to confirm'),
})

function SetPasswordDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const errors = useFormErrors()
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const save = useMutation({
    mutationFn: (input: { password: string; currentPassword: string }) => api(`/api/team/${member.id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      toast.success(`New password set for ${member.name}`)
      onClose()
    },
    onError: errors.fromError,
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(setPasswordInput, { password, currentPassword })
    if (input) save.mutate(input)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Set a new password for {member.name}</DialogTitle>
            <DialogDescription>They’ll be signed out everywhere. Tell them the new password yourself.</DialogDescription>
          </DialogHeader>
          <FormError message={errors.form} />
          <Field label="New password" description="At least 8 characters" error={errors.fields.password}>
            {(p) => <Input {...p} type="text" autoComplete="off" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />}
          </Field>
          <Field label="Your password" description="Enter your own password to confirm it’s you." error={errors.fields.currentPassword}>
            {(p) => <Input {...p} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Set password'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RemoveDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api(`/api/team/${member.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(`${member.name} removed`)
      queryClient.invalidateQueries({ queryKey: ['team'] })
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {member.name}?</DialogTitle>
          <DialogDescription>They lose access right away. Forms they made stay with the team.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>{remove.isPending ? 'Removing…' : 'Remove member'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransferDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const queryClient = useQueryClient()
  const errors = useFormErrors()
  const [currentPassword, setCurrentPassword] = useState('')
  const transfer = useMutation({
    mutationFn: () => api('/api/team/transfer-ownership', { method: 'POST', body: { userId: member.id, currentPassword } }),
    onSuccess: () => {
      toast.success(`${member.name} is now the Owner`)
      // Our own role changed: refetch everything that depends on it.
      queryClient.invalidateQueries()
      onClose()
    },
    onError: errors.fromError,
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!currentPassword) return errors.fromError(new Error('Enter your password to confirm'))
    transfer.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Make {member.name} the Owner?</DialogTitle>
            <DialogDescription>
              There is only one Owner. You’ll become an Editor and lose access to Team management and App settings.
            </DialogDescription>
          </DialogHeader>
          <FormError message={errors.form} />
          <Field label="Your password" error={errors.fields.currentPassword}>
            {(p) => <Input {...p} type="password" autoComplete="current-password" autoFocus value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={transfer.isPending}>{transfer.isPending ? 'Transferring…' : 'Transfer ownership'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Bold,
  Copy,
  FileText,
  Inbox,
  Italic,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Settings,
  Trash2,
  Underline,
  Users,
  CircleAlert,
  Info,
  CircleCheck,
  TriangleAlert,
} from 'lucide-react'
import { Field } from '@/components/common/Field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleChevron, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/ds'
import { FAKE_FOCUS, Section, Specimen, State } from './parts'

const ROWS = [
  { name: 'Customer feedback', status: 'live', responses: 1284, updated: '2 hours ago' },
  { name: 'Event registration', status: 'unpublished', responses: 312, updated: 'Yesterday' },
  { name: 'Job application', status: 'draft', responses: 0, updated: 'Oct 12' },
  { name: 'Product survey 2025', status: 'closed', responses: 4410, updated: 'Sep 30' },
] as const

export function UiComponents() {
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 9, 19))
  const [showArchived, setShowArchived] = useState(false)
  const [overlay, setOverlay] = useState(40)

  return (
    <>
      <Section id="buttons" title="Buttons" intro="One primary button per view. Primary is periwinkle and secondary is paper, both with a 2px ink edge; radius md (12px), Figtree 500 14px, never wraps. Focus is the 2px ring.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen title="Variants">
            <Button>Publish</Button>
            <Button variant="secondary">Preview</Button>
            <Button variant="outline">Duplicate</Button>
            <Button variant="ghost">Copy link</Button>
            <Button variant="destructive">Delete form</Button>
            <Button variant="link">View responses</Button>
          </Specimen>
          <Specimen title="Sizes" note="xs 24 · sm 32 · default 40 (dashboard) · lg 48 (respondent forms)">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Start</Button>
          </Specimen>
          <Specimen title="With icons and icon-only" note="Icon buttons always carry an accessible name.">
            <Button>
              <Plus aria-hidden /> New form
            </Button>
            <Button variant="secondary">
              <Copy aria-hidden /> Copy link
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="More actions (extra small)">
              <MoreHorizontal aria-hidden />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="More actions (small)">
              <MoreHorizontal aria-hidden />
            </Button>
            <Button size="icon" variant="outline" aria-label="Settings">
              <Settings aria-hidden />
            </Button>
            <Button size="icon-lg" aria-label="Send">
              <Send aria-hidden />
            </Button>
          </Specimen>
          <Specimen title="States" note="Hover: primary steps to primary-hover; secondary, outline and ghost take accent.">
            <State label="Focus (static)">
              <Button className={FAKE_FOCUS}>Publish</Button>
            </State>
            <State label="Disabled">
              <Button disabled>Publish</Button>
            </State>
            <State label="Loading">
              <Button
                disabled={saving}
                aria-busy={saving || undefined}
                onClick={() => {
                  setSaving(true)
                  setTimeout(() => setSaving(false), 1500)
                }}
                className="min-w-24"
              >
                {saving ? (
                  <>
                    <Spinner /> Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </State>
            <State label="Loading (static)">
              <Button disabled aria-busy className="min-w-24">
                <Spinner /> Saving…
              </Button>
            </State>
          </Specimen>
        </div>
      </Section>

      <Section id="inputs" title="Inputs" intro="Field background, 1px input outline (3:1), 16px text, md radius (12px). Errors swap it to destructive and add a message with an icon.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen title="Input" bodyClassName="grid gap-5 sm:grid-cols-2">
            <Field label="Email address" required description="We'll only use this to reply.">
              {(p) => <Input {...p} type="email" placeholder="name@example.com" />}
            </Field>
            <Field label="Your name" description="Focus (static)">
              {(p) => <Input {...p} defaultValue="Hasan Shahrier" className={FAKE_FOCUS} />}
            </Field>
            <Field label="Website" error="Enter a full address like https://example.com">
              {(p) => <Input {...p} defaultValue="example" />}
            </Field>
            <Field label="Workspace" description="Disabled">
              {(p) => <Input {...p} defaultValue="EzyStudio" disabled />}
            </Field>
          </Specimen>
          <Specimen title="Textarea and select" bodyClassName="grid gap-5 sm:grid-cols-2">
            <Field label="Description">
              {(p) => <Textarea {...p} placeholder="Tell respondents what this form is for" />}
            </Field>
            <Field label="Notes" error="Keep it under 500 characters">
              {(p) => <Textarea {...p} defaultValue="This answer is far too long" />}
            </Field>
            <Field label="Layout">
              {(p) => (
                <Select defaultValue="classic">
                  <SelectTrigger {...p} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="classic">Classic</SelectItem>
                    <SelectItem value="paged">Paged</SelectItem>
                    <SelectItem value="one">One at a time</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Role" error="Choose a role">
              {(p) => (
                <Select>
                  <SelectTrigger {...p} className="w-full">
                    <SelectValue placeholder="Choose a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <State label="Small select (toolbars)">
              <Select defaultValue="7">
                <SelectTrigger size="sm" aria-label="Date range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </State>
            <State label="Disabled">
              <Select disabled defaultValue="classic">
                <SelectTrigger aria-label="Layout (disabled)" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="classic">Classic</SelectItem>
                </SelectContent>
              </Select>
            </State>
          </Specimen>
          <Specimen title="Checkbox, radio, switch" note="Outline is input (3:1); checked takes the ink edge (switch: ink track, periwinkle thumb)." bodyClassName="grid gap-6 sm:grid-cols-3">
            <div className="grid content-start gap-3">
              <Label className="font-normal">
                <Checkbox /> Unchecked
              </Label>
              <Label className="font-normal">
                <Checkbox defaultChecked /> Checked
              </Label>
              <Label className="font-normal">
                <Checkbox checked="indeterminate" /> Indeterminate
              </Label>
              <Label className="font-normal">
                <Checkbox aria-invalid /> Error
              </Label>
              <Label className="font-normal">
                <Checkbox disabled /> Disabled
              </Label>
              <Label className="font-normal">
                <Checkbox className={FAKE_FOCUS} /> Focus (static)
              </Label>
            </div>
            <RadioGroup defaultValue="editor" aria-label="Role" className="content-start">
              <Label className="font-normal">
                <RadioGroupItem value="editor" /> Editor
              </Label>
              <Label className="font-normal">
                <RadioGroupItem value="viewer" /> Viewer
              </Label>
              <Label className="font-normal">
                <RadioGroupItem value="owner" disabled /> Owner (disabled)
              </Label>
            </RadioGroup>
            <div className="grid content-start gap-3">
              <Label className="font-normal">
                <Switch defaultChecked /> Accept responses
              </Label>
              <Label className="font-normal">
                <Switch /> Email me
              </Label>
              <Label className="font-normal">
                <Switch size="sm" defaultChecked /> Small
              </Label>
              <Label className="font-normal">
                <Switch disabled /> Disabled
              </Label>
            </div>
          </Specimen>
          <Specimen title="Toggle and toggle group">
            <Toggle aria-label="Bold">
              <Bold aria-hidden />
            </Toggle>
            <Toggle aria-label="Italic" defaultPressed>
              <Italic aria-hidden />
            </Toggle>
            <ToggleGroup type="single" variant="outline" defaultValue="desktop" aria-label="Preview device">
              <ToggleGroupItem value="desktop">Desktop</ToggleGroupItem>
              <ToggleGroupItem value="mobile">Mobile</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup type="multiple" aria-label="Text style">
              <ToggleGroupItem value="b" aria-label="Bold">
                <Bold aria-hidden />
              </ToggleGroupItem>
              <ToggleGroupItem value="i" aria-label="Italic">
                <Italic aria-hidden />
              </ToggleGroupItem>
              <ToggleGroupItem value="u" aria-label="Underline">
                <Underline aria-hidden />
              </ToggleGroupItem>
            </ToggleGroup>
          </Specimen>
          <Specimen title="Slider" note="Rail is progress-track, fill is ink; the periwinkle thumb has the 2px ink edge, grows on hover and sinks while dragged." bodyClassName="grid gap-2">
            <div className="flex justify-between text-label">
              <span id="ds-slider-label">Darken</span>
              <span className="text-muted-foreground tabular-nums">{overlay}%</span>
            </div>
            <Slider aria-labelledby="ds-slider-label" min={0} max={80} step={5} value={[overlay]} onValueChange={([v]) => setOverlay(v ?? 0)} />
          </Specimen>
          <Specimen title="Collapsible and spinner" note="Content opens over 200ms and the chevron turns; the spinner stops turning under reduced motion." bodyClassName="grid gap-4">
            <Collapsible className="rounded-lg border border-border bg-muted px-4 py-3 text-body-sm">
              <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-sm text-left text-label">
                <CollapsibleChevron />
                DNS checklist for reliable delivery
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ol className="mt-3 grid list-decimal gap-1.5 pl-11 text-muted-foreground">
                  <li>Add the SPF record to your domain.</li>
                  <li>Publish the DKIM key.</li>
                  <li>Set a DMARC policy.</li>
                </ol>
              </CollapsibleContent>
            </Collapsible>
            <div className="flex items-center gap-3 text-body-sm text-muted-foreground">
              <Spinner label="Loading" /> Loading responses
            </div>
          </Specimen>
        </div>
      </Section>

      <Section id="display" title="Display" intro="Badges are pills (Live is pine, Draft is outlined ink, Closed is muted); cards rest on a border with no shadow; alerts use the subtle pairs and always carry an icon or a title.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen title="Badge">
            <Badge>Owner</Badge>
            <Badge variant="secondary">Editor</Badge>
            <Badge variant="outline">Viewer</Badge>
            <Badge variant="muted">Archived</Badge>
            <Badge variant="pine">Live</Badge>
            <Badge variant="success">Delivered</Badge>
            <Badge variant="warning">Retrying</Badge>
            <Badge variant="info">Tip</Badge>
            <Badge variant="danger">Failed</Badge>
            <Badge variant="destructive">Blocked</Badge>
          </Specimen>
          <Specimen title="Avatar, skeleton, separator, tooltip">
            <Avatar>
              <AvatarFallback>HS</AvatarFallback>
            </Avatar>
            <Avatar size="lg">
              <AvatarFallback>AL</AvatarFallback>
            </Avatar>
            <Avatar size="sm">
              <AvatarFallback>RK</AvatarFallback>
            </Avatar>
            <Separator orientation="vertical" className="h-8!" />
            <div className="grid w-40 gap-2" aria-label="Loading" role="status">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Copy embed code">
                  <Copy aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy embed code</TooltipContent>
            </Tooltip>
          </Specimen>
          <Card>
            <CardHeader>
              <CardTitle>Customer feedback</CardTitle>
              <CardDescription>Classic layout · 12 questions</CardDescription>
              <CardAction>
                <StatusBadge status="live" />
              </CardAction>
            </CardHeader>
            <CardContent className="text-body text-muted-foreground">
              Card at rest: card fill, 1px border, radius lg, 24px padding, no shadow.
            </CardContent>
            <CardFooter className="justify-end">
              <Button variant="ghost">Share</Button>
              <Button>Open builder</Button>
            </CardFooter>
          </Card>
          <div className="grid content-start gap-3">
            <Alert>
              <Info aria-hidden />
              <AlertTitle>Default</AlertTitle>
              <AlertDescription>Logic rules run in the order they are listed.</AlertDescription>
            </Alert>
            <Alert variant="info">
              <Info aria-hidden />
              <AlertTitle>Tip</AlertTitle>
              <AlertDescription>Press a letter key to pick an option in one-at-a-time mode.</AlertDescription>
            </Alert>
            <Alert variant="success">
              <CircleCheck aria-hidden />
              <AlertTitle>Webhook delivered</AlertTitle>
            </Alert>
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertTitle>Unpublished changes</AlertTitle>
              <AlertDescription>Respondents still see the last published version.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertTitle>Couldn't save the form</AlertTitle>
              <AlertDescription>Check your connection and try again.</AlertDescription>
            </Alert>
          </div>
        </div>
      </Section>

      <Section id="navigation" title="Navigation" intro="Tabs in the label style; the sidebar is white with an accent active item.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen title="Tabs" bodyClassName="grid gap-6">
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">All forms</TabsTrigger>
                <TabsTrigger value="live">Live</TabsTrigger>
                <TabsTrigger value="drafts">Drafts</TabsTrigger>
                <TabsTrigger value="closed" disabled>
                  Closed
                </TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="text-body-sm text-muted-foreground">
                Segmented tabs on muted.
              </TabsContent>
              <TabsContent value="live" className="text-body-sm text-muted-foreground">
                Live forms.
              </TabsContent>
              <TabsContent value="drafts" className="text-body-sm text-muted-foreground">
                Drafts.
              </TabsContent>
            </Tabs>
            <Tabs defaultValue="build">
              <TabsList variant="line">
                <TabsTrigger value="build">Build</TabsTrigger>
                <TabsTrigger value="design">Design</TabsTrigger>
                <TabsTrigger value="logic">Logic</TabsTrigger>
                <TabsTrigger value="share">Share</TabsTrigger>
              </TabsList>
              <TabsContent value="build" className="text-body-sm text-muted-foreground">
                Line tabs for the builder header.
              </TabsContent>
            </Tabs>
          </Specimen>
          <Specimen title="Sidebar" note="collapsible='none' so it renders inline here." bodyClassName="block">
            <SidebarProvider className="min-h-0 overflow-hidden rounded-lg border border-border">
              <Sidebar collapsible="none" className="w-full">
                <SidebarContent>
                  <SidebarGroup>
                    <SidebarGroupLabel>Workspace</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <SidebarMenuButton isActive>
                            <FileText aria-hidden /> <span>Forms</span>
                          </SidebarMenuButton>
                          <SidebarMenuBadge>12</SidebarMenuBadge>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton>
                            <Inbox aria-hidden /> <span>Templates</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton>
                            <Users aria-hidden /> <span>Team</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton>
                            <Settings aria-hidden /> <span>Settings</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                </SidebarContent>
              </Sidebar>
            </SidebarProvider>
          </Specimen>
        </div>
      </Section>

      <Section id="overlays" title="Overlays" intro="Menus, popovers, selects and dialogs are the only surfaces with a shadow (shadow-pop). Menus use radius md, dialogs radius xl, over a tinted scrim.">
        <Specimen title="Triggers" note="Open each to check it.">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename form</DialogTitle>
                <DialogDescription>The new name shows in the dashboard and on the front page.</DialogDescription>
              </DialogHeader>
              <Field label="Form name">{(p) => <Input {...p} defaultValue="Customer feedback" />}</Field>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>Save</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Alert dialog</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this form?</AlertDialogTitle>
                <AlertDialogDescription>Its 1,284 responses are deleted too. This can't be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive">Delete form</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Response #128</SheetTitle>
                <SheetDescription>Submitted Oct 19, 2026 at 10:42</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 px-6 text-body">
                <p className="text-muted-foreground">Answers appear here.</p>
              </div>
              <SheetFooter>
                <Button variant="secondary">Export PDF</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                Menu <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel>Form</DropdownMenuLabel>
              <DropdownMenuItem>
                <Pencil aria-hidden /> Rename <DropdownMenuShortcut>R</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Copy aria-hidden /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={showArchived} onCheckedChange={setShowArchived}>
                Show archived
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem disabled>Move to folder</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <Trash2 aria-hidden /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Popover</Button>
            </PopoverTrigger>
            <PopoverContent>
              <PopoverHeader>
                <PopoverTitle>Embed</PopoverTitle>
                <PopoverDescription>Paste this where the form should appear.</PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>
          <Button variant="outline" onClick={() => toast.success('Link copied')}>
            Toast
          </Button>
          <Button variant="outline" onClick={() => toast.error("Couldn't publish. Fix the 2 questions with errors first.")}>
            Error toast
          </Button>
        </Specimen>
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen title="Command" note="Inline here; usually inside a popover (shadow-pop)." bodyClassName="block">
            <Command className="rounded-lg border border-border">
              <CommandInput placeholder="Search forms…" aria-label="Search forms" />
              <CommandList>
                <CommandEmpty>No forms found.</CommandEmpty>
                <CommandGroup heading="Forms">
                  <CommandItem>
                    <FileText aria-hidden /> Customer feedback
                  </CommandItem>
                  <CommandItem>
                    <FileText aria-hidden /> Event registration <CommandShortcut>E</CommandShortcut>
                  </CommandItem>
                  <CommandItem disabled>
                    <FileText aria-hidden /> Job application
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </Specimen>
          <Specimen title="Calendar" note="react-day-picker v10, tokenised.">
            <Calendar mode="single" selected={date} onSelect={setDate} defaultMonth={new Date(2026, 9, 1)} className="rounded-lg border border-border" />
          </Specimen>
        </div>
      </Section>

      <Section id="table" title="Table" intro="body-sm cells, a muted header row in the label style, accent/50 on row hover, tabular numbers.">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Form</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Responses</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((r, i) => (
                <TableRow key={r.name} data-state={i === 0 ? 'selected' : undefined}>
                  <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.responses.toLocaleString('en')}</TableCell>
                  <TableCell className="text-muted-foreground">{r.updated}</TableCell>
                  <TableCell>
                    <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${r.name}`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </>
  )
}

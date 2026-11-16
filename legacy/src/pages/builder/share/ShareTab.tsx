import { useEffect, useId, useState } from 'react'
import { Check, Copy, Download, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { formSlug } from '@shared/api-forms'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import { FieldRow, Note, SegmentRow, SwitchRow, TextRow } from '@/builder/controls'
import { useDraftText } from '@/builder/use-draft-text'
import { ImageUpload } from '@/builder/ImageUpload'
import { useBuilder, useBuilderStore } from '@/builder/store'
import { useSettingsSave } from '../settings/hooks'
import { SettingsCard } from '../settings/shared'

const formUrl = (slug: string) => `${location.origin}/f/${slug}`

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
  } catch {
    toast.error('Couldn’t copy. Select the text and copy it yourself.')
  }
}

/** Share tab (PRD "Sharing and publishing"): link, slug, SEO, embeds, QR code, homepage listing. */
export function ShareTab() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-3xl gap-6 px-6 py-8">
        <LinkSection />
        <SeoSection />
        <EmbedSection />
        <PopupSection />
        <QrSection />
        <FrontPageSection />
      </div>
    </div>
  )
}

function LinkSection() {
  const store = useBuilderStore()
  const slug = useBuilder((s) => s.meta.slug)
  const status = useBuilder((s) => s.meta.status)
  const readOnly = useBuilder((s) => s.readOnly)
  const [text, setText] = useState(slug)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [shownSlug, setShownSlug] = useState(slug)
  if (shownSlug !== slug) {
    setShownSlug(slug)
    setText(slug)
  }
  const url = formUrl(slug)
  const dirty = text.trim().toLowerCase() !== slug

  async function saveSlug() {
    const parsed = formSlug.safeParse(text)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the link')
    setSaving(true)
    try {
      await store.getState().patchSlug(parsed.data)
      setError(null)
      toast.success('Link changed. The old link still works.')
    } catch (raw) {
      const err = raw as { message?: string; fields?: Record<string, string[] | undefined> }
      setError(err.fields?.slug?.[0] ?? err.message ?? 'That link couldn’t be saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard id="link" title="Link" description={status === 'draft' ? 'The link works once you publish the form. Until then visitors see “not found”.' : undefined}>
      <div className="flex gap-2">
        <Input readOnly value={url} aria-label="Form link" className="font-mono text-body-sm" onFocus={(e) => e.currentTarget.select()} />
        <Button onClick={() => copy(url, status === 'draft' ? 'Link copied. It works once you publish the form.' : 'Link copied')}>
          <Copy aria-hidden />
          Copy link
        </Button>
        <Button asChild variant="secondary">
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden />
            Open
          </a>
        </Button>
      </div>
      {!readOnly && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void saveSlug()
          }}
        >
          <FieldRow label="Custom link" error={error} description="Letters, digits and hyphens. When you change it, the old link keeps working and redirects here.">
            {({ id, describedBy, invalid }) => (
              <div className="flex gap-2">
                <div className="flex min-w-0 flex-1 items-center rounded-md border border-input bg-field focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
                  <span className="pl-3 font-mono text-body-sm whitespace-nowrap text-muted-foreground">{location.host}/f/</span>
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    value={text}
                    maxLength={60}
                    onChange={(e) => (setText(e.target.value), setError(null))}
                    className="h-(--control-md) min-w-0 flex-1 bg-transparent pr-3 font-mono text-body-sm text-foreground outline-none"
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={!dirty || saving}>
                  {saving && <Spinner />}
                  Save link
                </Button>
              </div>
            )}
          </FieldRow>
        </form>
      )}
    </SettingsCard>
  )
}

function SeoSection() {
  const settings = useBuilder((s) => s.settings)
  const title = useBuilder((s) => s.doc.title)
  const readOnly = useBuilder((s) => s.readOnly)
  const { save, errors } = useSettingsSave()
  const seoTitle = useDraftText(settings.seoTitle, (v) => void save({ seoTitle: v }))
  const seoDescription = useDraftText(settings.seoDescription, (v) => void save({ seoDescription: v }))
  return (
    <SettingsCard id="seo" title="Search and social preview" description="How the link looks when shared in chats and social posts.">
      <TextRow label="Page title" maxLength={120} placeholder={title} disabled={readOnly} error={errors.seoTitle} {...seoTitle} />
      <TextRow label="Description" multiline maxLength={300} placeholder="One or two sentences about the form" disabled={readOnly} error={errors.seoDescription} {...seoDescription} />
      <ImageUpload
        label="Preview image"
        description="1200 × 630 works best. Without one, a card is made from the title and your theme."
        purpose="og"
        aspect="aspect-[1200/630]"
        value={settings.ogImage}
        disabled={readOnly}
        onChange={(url) => void save({ ogImage: url })}
      />
      <SwitchRow
        label="Hide from search engines"
        description="Asks Google and others not to list the form. On by default: most forms are shared by link."
        checked={settings.noindex}
        disabled={readOnly}
        onCheckedChange={(v) => void save({ noindex: v })}
      />
    </SettingsCard>
  )
}

function Snippet({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-2">
      <pre aria-label={label} tabIndex={0} className="focus-ring max-h-48 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-caption whitespace-pre-wrap text-foreground">
        {code}
      </pre>
      <Button
        variant="secondary"
        size="sm"
        className="w-fit"
        onClick={async () => {
          await copy(code, 'Code copied')
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        Copy code
      </Button>
    </div>
  )
}

function EmbedSection() {
  const slug = useBuilder((s) => s.meta.slug)
  const title = useBuilder((s) => s.doc.title)
  const [width, setWidth] = useState<'full' | 'fixed'>('full')
  const [px, setPx] = useState('640')
  const [height, setHeight] = useState('600')
  const [transparent, setTransparent] = useState(false)
  const [hideTitle, setHideTitle] = useState(false)
  const params = new URLSearchParams({ embed: '1' })
  if (transparent) params.set('transparent', '1')
  if (hideTitle) params.set('hideTitle', '1')
  const w = width === 'full' ? '100%' : `${Math.max(240, Number(px) || 640)}px`
  const h = `${Math.max(200, Number(height) || 600)}px`
  const safeTitle = title.replace(/"/g, '&quot;')
  const code = `<iframe data-intelform src="${location.origin}/f/${slug}?${params}" title="${safeTitle}" loading="lazy" style="width:${w};max-width:100%;height:${h};border:0"></iframe>
<script src="${location.origin}/embed.js" async></script>`

  return (
    <SettingsCard id="embed" title="Embed in a page" description="Paste into any website. The form keeps its theme, and its height follows the content. Theme changes never need a new snippet.">
      <div className="grid grid-cols-2 gap-4">
        <SegmentRow
          label="Width"
          value={width}
          options={[
            { value: 'full', label: 'Full width' },
            { value: 'fixed', label: 'Fixed' },
          ]}
          onChange={(v) => setWidth(v as 'full' | 'fixed')}
        />
        {width === 'fixed' ? <TextRow label="Width in pixels" inputMode="numeric" value={px} onChange={setPx} /> : <span />}
        <TextRow label="Starting height in pixels" description="It grows to fit once loaded." inputMode="numeric" value={height} onChange={setHeight} />
      </div>
      <SwitchRow label="Transparent background" description="Lets your page show through behind the form." checked={transparent} onCheckedChange={setTransparent} />
      <SwitchRow label="Hide the form title" checked={hideTitle} onCheckedChange={setHideTitle} />
      <Snippet code={code} label="Embed code" />
    </SettingsCard>
  )
}

function PopupSection() {
  const slug = useBuilder((s) => s.meta.slug)
  const themeButton = useBuilder((s) => s.doc.theme.colors.button)
  const themeText = useBuilder((s) => s.doc.theme.colors.buttonText)
  const [label, setLabel] = useState('Take the survey')
  const [color, setColor] = useState<string | null>(null)
  const colorId = useId()
  const bg = color ?? themeButton
  const esc = (v: string) => v.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
  const code = `<button type="button" data-intelform-popup="${slug}" data-color="${bg}" style="background:${bg};color:${themeText};border:0;border-radius:8px;padding:12px 20px;font:600 16px system-ui,sans-serif;cursor:pointer">${esc(label || 'Open form')}</button>
<script src="${location.origin}/embed.js" async></script>`

  return (
    <SettingsCard id="popup" title="Popup" description="A button on your page that opens the form in a window over it (full screen on phones).">
      <div className="grid grid-cols-[minmax(0,1fr)_12rem] gap-4">
        <TextRow label="Button label" value={label} maxLength={40} onChange={setLabel} />
        <div className="grid gap-1.5">
          <label htmlFor={colorId} className="text-label">
            Button colour
          </label>
          <div className="flex items-center gap-2">
            <input
              id={colorId}
              type="color"
              value={bg.toLowerCase()}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
              className="focus-ring size-10 cursor-pointer rounded-md border border-input bg-field p-1"
            />
            <span className="font-mono text-body-sm">{bg}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-md border border-dashed border-input p-4">
        <span className="text-caption text-muted-foreground">Looks like</span>
        {/* The sample uses the creator's chosen colours: data, not app chrome. */}
        <span className="rounded-lg px-5 py-3 text-label" style={{ background: bg, color: themeText }}>
          {label || 'Open form'}
        </span>
      </div>
      <Snippet code={code} label="Popup code" />
    </SettingsCard>
  )
}

function QrSection() {
  const slug = useBuilder((s) => s.meta.slug)
  const url = formUrl(slug)
  const [png, setPng] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void import('qrcode').then((QR) =>
      QR.toDataURL(url, { errorCorrectionLevel: 'H', margin: 2, width: 480 }).then((d) => live && setPng(d)),
    )
    return () => {
      live = false
    }
  }, [url])

  async function download(kind: 'png' | 'svg') {
    const QR = await import('qrcode')
    const name = `form-${slug}-qr.${kind}`
    let href: string
    if (kind === 'svg') {
      const svg = await QR.toString(url, { type: 'svg', errorCorrectionLevel: 'H', margin: 2 })
      // Room under the code for the short URL, so a printed code can be typed in too.
      const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
      const w = Number(m?.[1] ?? 33)
      const h = Number(m?.[2] ?? 33)
      const short = url.replace(/^https?:\/\//, '')
      const size = Math.min(2.4, (w * 1.7) / short.length)
      const out = svg
        .replace(/viewBox="0 0 \d+ \d+"/, `viewBox="0 0 ${w} ${h + 4}"`)
        .replace(/(<svg[^>]*>)/, `$1<rect width="${w}" height="${h + 4}" fill="#FFFFFF"/>`)
        .replace('</svg>', `<text x="${w / 2}" y="${h + 2}" text-anchor="middle" font-family="sans-serif" font-size="${size.toFixed(2)}" fill="#000000">${short}</text></svg>`)
      href = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml' }))
    } else {
      const canvas = document.createElement('canvas')
      await QR.toCanvas(canvas, url, { errorCorrectionLevel: 'H', margin: 2, width: 1024 })
      const out = document.createElement('canvas')
      out.width = canvas.width
      out.height = canvas.height + 80
      const ctx = out.getContext('2d')!
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(canvas, 0, 0)
      ctx.fillStyle = '#000000'
      ctx.font = '36px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(url.replace(/^https?:\/\//, ''), out.width / 2, canvas.height + 40)
      href = out.toDataURL('image/png')
    }
    const a = document.createElement('a')
    a.href = href
    a.download = name
    a.click()
    if (kind === 'svg') setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  return (
    <SettingsCard id="qr" title="QR code" description="For posters, flyers and slides. High error correction, so it still scans when printed small.">
      <div className="flex flex-wrap items-center gap-6">
        <figure className="grid justify-items-center gap-2 rounded-lg border border-border bg-card p-3">
          {png ? <img src={png} alt={`QR code for ${url}`} className="size-44" /> : <div className="size-44 animate-pulse rounded-md bg-muted" />}
          <figcaption className="font-mono text-caption text-muted-foreground">{url.replace(/^https?:\/\//, '')}</figcaption>
        </figure>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => void download('png')}>
            <Download aria-hidden />
            Download PNG
          </Button>
          <Button variant="secondary" onClick={() => void download('svg')}>
            <Download aria-hidden />
            Download SVG
          </Button>
        </div>
      </div>
    </SettingsCard>
  )
}

function FrontPageSection() {
  const settings = useBuilder((s) => s.settings)
  const status = useBuilder((s) => s.meta.status)
  const readOnly = useBuilder((s) => s.readOnly)
  const { save, errors } = useSettingsSave()
  const description = useDraftText(settings.frontPageDescription, (v) => void save({ frontPageDescription: v }))
  return (
    <SettingsCard id="front-page" title="Homepage" description="Your public site lists the forms you choose, by title. Only live forms appear.">
      <SwitchRow
        label="Show on the homepage"
        checked={settings.showOnFrontPage}
        disabled={readOnly}
        onCheckedChange={(v) => void save({ showOnFrontPage: v }, v ? 'Added to the homepage' : 'Removed from the homepage')}
      />
      {settings.showOnFrontPage && status !== 'live' && <Note>It appears once the form is live.</Note>}
      <TextRow
        label="Card description"
        multiline
        maxLength={300}
        placeholder="A sentence that tells visitors what the form is for"
        disabled={readOnly || !settings.showOnFrontPage}
        error={errors.frontPageDescription}
        {...description}
      />
    </SettingsCard>
  )
}

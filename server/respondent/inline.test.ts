import { describe, expect, it } from 'vitest'
import '../test/env'

const { injectForm } = await import('./inline')
const { contentSecurityPolicy, securityHeaders, surfaceFor } = await import('../middleware/security-headers')

const SHELL = '<!doctype html><html lang="en"><head><title>Form</title></head><body><div id="root"></div></body></html>'

describe('injectForm', () => {
  it('inlines the payload as inert JSON that cannot close the script tag', () => {
    const payload = {
      status: 'closed',
      id: 'x',
      slug: 's',
      title: 'Hi </script><script>alert(1)</script>',
      theme: {},
      message: 'closed',
      settings: { seoTitle: '', seoDescription: 'A "quoted" <b>form</b>', ogImage: null, noindex: true },
    } as never
    const html = injectForm(SHELL, payload)
    expect(html).toContain('<title>Hi &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>')
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).toContain('content="A &quot;quoted&quot; &lt;b&gt;form&lt;/b&gt;"')
    const json = /<script type="application\/json" id="__FORM__">([\s\S]*?)<\/script>/.exec(html)![1]
    expect(json).not.toContain('<')
    expect(JSON.parse(json).title).toBe('Hi </script><script>alert(1)</script>')
  })

  it('keeps $ replacement patterns in creator text literally', () => {
    const tricky = "Salary $'000s $& $` $$ $1 $<x>"
    const payload = {
      status: 'live',
      id: 'x',
      slug: 's',
      title: tricky,
      theme: {},
      definition: { fields: [{ id: 'f_1', type: 'short_text', label: tricky }] },
      settings: { seoTitle: '', seoDescription: tricky, ogImage: tricky, noindex: false },
    } as never
    const html = injectForm(SHELL, payload)
    const escaped = tricky.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    expect(html).toContain(`<title>${escaped}</title>`)
    expect(html).toContain(`<meta name="description" content="${escaped}">`)
    expect(html).toContain(`<meta property="og:title" content="${escaped}">`)
    expect(html).toContain(`<meta property="og:image" content="${escaped}">`)
    // The shell around the injected parts is intact: one head, one body, nothing spliced.
    expect(html.match(/<\/head>/g)).toHaveLength(1)
    expect(html.match(/<title>/g)).toHaveLength(1)
    expect(html.endsWith('<body><div id="root"></div></body></html>')).toBe(true)
    const json = /<script type="application\/json" id="__FORM__">([\s\S]*?)<\/script>\n<\/head>/.exec(html)![1]
    expect(JSON.parse(json)).toEqual(payload)
  })

  it('keeps $ patterns in the payload of a moved or missing form', () => {
    const payload = { status: 'moved', slug: "$'$`$&$$" } as never
    const json = /<script type="application\/json" id="__FORM__">([\s\S]*?)<\/script>\n<\/head>/.exec(injectForm(SHELL, payload))![1]
    expect(JSON.parse(json)).toEqual(payload)
  })

  it('marks unknown forms as missing', () => {
    expect(injectForm(SHELL, null)).toContain('{"status":"missing"}')
  })
})

describe('frame-ancestors', () => {
  it('lets any site frame /f/* and embed.js, and nothing else', () => {
    expect(surfaceFor('/f/abc')).toBe('form')
    expect(surfaceFor('/embed.js')).toBe('form')
    expect(contentSecurityPolicy('form')).toContain('frame-ancestors *')
    expect(securityHeaders('form')['X-Frame-Options']).toBeUndefined()
    expect(contentSecurityPolicy('dashboard')).toContain("frame-ancestors 'none'")
    expect(securityHeaders('dashboard')['X-Frame-Options']).toBe('DENY')
  })
})

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
      labels: {},
      lang: 'de',
      message: 'closed',
      settings: { seoTitle: '', seoDescription: 'A "quoted" <b>form</b>', ogImage: null, noindex: true },
    } as never
    const html = injectForm(SHELL, payload)
    expect(html).toContain('<html lang="de"')
    expect(html).toContain('<title>Hi &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>')
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).toContain('content="A &quot;quoted&quot; &lt;b&gt;form&lt;/b&gt;"')
    const json = /<script type="application\/json" id="__FORM__">([\s\S]*?)<\/script>/.exec(html)![1]
    expect(json).not.toContain('<')
    expect(JSON.parse(json).title).toBe('Hi </script><script>alert(1)</script>')
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

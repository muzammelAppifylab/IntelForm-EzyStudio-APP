import { describe, expect, it } from 'vitest'
import { redirectAfterSubmit, withoutAnswers, type RedirectWindow } from './redirect'

function fakeWindow(opts: { framed: boolean; topBlocked?: boolean }) {
  const log: { assigned?: string; top?: string; posted: { message: unknown; target: string }[] } = { posted: [] }
  const parent = { postMessage: (message: unknown, target: string) => log.posted.push({ message, target }) }
  const win: RedirectWindow = {
    location: { assign: (url) => (log.assigned = url) },
    parent,
    top: {
      location: {
        set href(url: string) {
          if (opts.topBlocked) throw new DOMException('blocked', 'SecurityError')
          log.top = url
        },
        get href() {
          return log.top ?? ''
        },
      },
    },
  }
  if (!opts.framed) win.parent = win as unknown as RedirectWindow['parent']
  return { win, log }
}

const ids = ['f_name', 'f_email']
const withAnswers = 'https://example.com/thanks?ref=ad&f_name=Ada&f_email=ada%40example.com'

describe('redirect after submit', () => {
  it('strips appended answers, keeping the owner’s own parameters', () => {
    expect(withoutAnswers(withAnswers, ids)).toBe('https://example.com/thanks?ref=ad')
    expect(withoutAnswers('https://example.com/thanks?ref=a%20b', ids)).toBeNull()
  })

  it('navigates a top-level page with the full URL', () => {
    const { win, log } = fakeWindow({ framed: false })
    redirectAfterSubmit(withAnswers, ids, true, win)
    expect(log.assigned).toBe(withAnswers)
    expect(log.posted).toEqual([])
  })

  it('never posts answers to the parent of an embed', () => {
    const { win, log } = fakeWindow({ framed: true })
    redirectAfterSubmit(withAnswers, ids, true, win)
    expect(log.top).toBe(withAnswers)
    expect(log.posted).toEqual([])
  })

  it('falls back to the bare URL when top navigation is blocked', () => {
    const { win, log } = fakeWindow({ framed: true, topBlocked: true })
    redirectAfterSubmit(withAnswers, ids, true, win)
    expect(log.posted).toEqual([{ message: { type: 'intelform:redirect', url: 'https://example.com/thanks?ref=ad' }, target: '*' }])
  })

  it('asks embed.js to redirect when the URL carries no answers', () => {
    const { win, log } = fakeWindow({ framed: true })
    redirectAfterSubmit('https://example.com/thanks', ids, true, win)
    expect(log.top).toBeUndefined()
    expect(log.posted).toEqual([{ message: { type: 'intelform:redirect', url: 'https://example.com/thanks' }, target: '*' }])
  })

  it('ignores non-http URLs', () => {
    const { win, log } = fakeWindow({ framed: false })
    redirectAfterSubmit('javascript:alert(1)', ids, false, win)
    expect(log.assigned).toBeUndefined()
  })
})

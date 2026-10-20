import { forwardRef, useImperativeHandle, useRef } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'

/**
 * Invisible Turnstile (lazy: only forms with Turnstile on load it). Execute mode with
 * interaction-only appearance: the token is fetched on Submit, so long forms never outlive
 * its 300 s lifetime.
 */
export interface TurnstileHandle {
  getToken: () => Promise<string>
  reset: () => void
}

const TurnstileWidget = forwardRef<TurnstileHandle, { siteKey: string; lang: string }>(function TurnstileWidget({ siteKey, lang }, ref) {
  const inst = useRef<TurnstileInstance>(null)
  useImperativeHandle(ref, () => ({
    async getToken() {
      const t = inst.current
      if (!t) throw new Error('Turnstile is not ready')
      t.execute()
      return t.getResponsePromise(60_000)
    },
    reset() {
      inst.current?.reset()
    },
  }))
  return (
    <div className="flex justify-center px-4 pb-6">
      <Turnstile
        ref={inst}
        siteKey={siteKey}
        options={{ execution: 'execute', appearance: 'interaction-only', action: 'submit', language: lang, theme: 'auto', size: 'flexible' }}
      />
    </div>
  )
})

export default TurnstileWidget

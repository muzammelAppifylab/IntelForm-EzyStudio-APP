import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';

/**
 * Invisible Cloudflare Turnstile (lazy: only forms with Turnstile on, and keys configured, load
 * it). Execute mode with interaction-only appearance: the token is fetched on Submit, so long
 * forms never outlive its 300 s lifetime.
 *
 * Cloudflare's script is the one outside script the public form loads. The page allows it in its
 * CSP only when the form uses Turnstile (`allowTurnstile` in src/pages/f/_lib/page.ts). Legacy
 * used @marsidev/react-turnstile; this is the same widget through Turnstile's own explicit API.
 */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

export interface TurnstileHandle {
  getToken: () => Promise<string>;
  reset: () => void;
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not start')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Turnstile did not load'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

const TurnstileWidget = forwardRef<TurnstileHandle, {siteKey: string}>(function TurnstileWidget({siteKey}, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<{api: TurnstileApi; id: string} | null>(null);
  /** The pending getToken() call: settled by the widget's callbacks. */
  const waiting = useRef<{resolve: (t: string) => void; reject: (e: Error) => void} | null>(null);

  useEffect(() => {
    let alive = true;
    loadTurnstile()
      .then(api => {
        if (!alive || !box.current) return;
        const id = api.render(box.current, {
          sitekey: siteKey,
          execution: 'execute',
          appearance: 'interaction-only',
          action: 'submit',
          language: 'en',
          theme: 'auto',
          size: 'flexible',
          callback: (token: string) => {
            waiting.current?.resolve(token);
            waiting.current = null;
          },
          'error-callback': () => {
            waiting.current?.reject(new Error('Turnstile failed'));
            waiting.current = null;
          },
          'expired-callback': () => api.reset(id),
        });
        widget.current = {api, id};
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (widget.current) widget.current.api.remove(widget.current.id);
      widget.current = null;
    };
  }, [siteKey]);

  useImperativeHandle(ref, () => ({
    getToken() {
      const w = widget.current;
      if (!w) return Promise.reject(new Error('Turnstile is not ready'));
      waiting.current?.reject(new Error('superseded'));
      return new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          waiting.current = null;
          reject(new Error('Turnstile timed out'));
        }, 60_000);
        waiting.current = {
          resolve: t => {
            window.clearTimeout(timer);
            resolve(t);
          },
          reject: e => {
            window.clearTimeout(timer);
            reject(e);
          },
        };
        w.api.execute(w.id);
      });
    },
    reset() {
      const w = widget.current;
      if (w) w.api.reset(w.id);
    },
  }));

  return <div ref={box} className="rf-turnstile" />;
});

export default TurnstileWidget;

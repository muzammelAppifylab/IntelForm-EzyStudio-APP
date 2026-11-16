import { useEffect, useRef, useState } from 'react'

/**
 * Local text state that commits after a pause or on blur. For settings that save to the server
 * (not undoable), so typing doesn't send a request per keystroke.
 */
export function useDraftText(value: string, commit: (v: string) => void, delay = 700) {
  const [text, setText] = useState(value)
  const textRef = useRef(value)
  useEffect(() => {
    textRef.current = text
  })
  const committed = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef(commit)
  useEffect(() => {
    commitRef.current = commit
  })
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setText(value)
    }
  }, [value])
  const flush = (v = text) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (v !== committed.current) {
      committed.current = v
      commitRef.current(v)
    }
  }
  // Leaving the panel mid-pause still saves what was typed.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        if (textRef.current !== committed.current) commitRef.current(textRef.current)
      }
    },
    [],
  )
  return {
    value: text,
    onChange(v: string) {
      setText(v)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => flush(v), delay)
    },
    onBlur: () => flush(),
  }
}

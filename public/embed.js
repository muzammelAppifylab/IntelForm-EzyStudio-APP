/*! IntelForm embed v1. Inline: <iframe data-intelform src="https://<site>/f/<slug>/?embed=1" style="width:100%;border:0" title="…"></iframe>
 * Popup: <button data-intelform-popup="<slug>">Take the survey</button> (optional data-color="#5B3FD9" sets the button colour). */
;(function () {
  var s = document.currentScript
  if (!s || window.__intelformEmbed) return
  window.__intelformEmbed = 1
  var ORIGIN = new URL(s.src).origin
  var dlg, frame, opener, overflow

  function frames() {
    return document.querySelectorAll('iframe[data-intelform]')
  }

  function close() {
    if (!dlg || !dlg.open) return
    dlg.close()
  }

  function onClosed() {
    if (frame) frame.src = 'about:blank'
    document.documentElement.style.overflow = overflow
    if (opener && opener.focus) opener.focus()
  }

  function open(slug, button) {
    opener = button
    if (!dlg) {
      dlg = document.createElement('dialog')
      dlg.setAttribute('aria-label', button.getAttribute('aria-label') || button.textContent.trim() || 'Form')
      dlg.style.cssText = 'padding:0;border:0;border-radius:16px;width:min(720px,calc(100vw - 32px));height:min(760px,calc(100vh - 32px));max-width:none;max-height:none;overflow:hidden;background:transparent'
      var x = document.createElement('button')
      x.type = 'button'
      x.setAttribute('aria-label', 'Close')
      x.innerHTML = '&times;'
      x.style.cssText = 'position:absolute;top:8px;right:8px;z-index:1;width:44px;height:44px;border:0;border-radius:22px;background:rgba(0,0,0,.55);color:#fff;font:24px/1 system-ui,sans-serif;cursor:pointer'
      x.onclick = close
      frame = document.createElement('iframe')
      frame.title = dlg.getAttribute('aria-label')
      frame.allow = 'clipboard-write'
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0;border-radius:inherit;background:#fff'
      dlg.appendChild(x)
      dlg.appendChild(frame)
      dlg.addEventListener('close', onClosed)
      dlg.addEventListener('click', function (e) {
        if (e.target === dlg) close()
      })
      var st = document.createElement('style')
      st.textContent =
        'dialog[data-intelform-dialog]::backdrop{background:rgba(10,8,20,.6)}@media (max-width:640px){dialog[data-intelform-dialog]{width:100vw!important;height:100dvh!important;max-width:100vw!important;max-height:100dvh!important;margin:0;border-radius:0!important}}'
      document.head.appendChild(st)
      dlg.setAttribute('data-intelform-dialog', '')
      document.body.appendChild(dlg)
    }
    frame.src = ORIGIN + '/f/' + encodeURIComponent(slug) + '/?embed=popup'
    overflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    dlg.showModal()
    frame.focus()
  }

  // Only our own frames may resize, close or redirect.
  addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || !e.source || !e.data || typeof e.data.type !== 'string') return
    var d = e.data
    var popup = frame && e.source === frame.contentWindow
    var inline, list = frames()
    for (var i = 0; i < list.length; i++) if (list[i].contentWindow === e.source) inline = list[i]
    if (!popup && !inline) return
    if (d.type === 'intelform:resize' && inline && typeof d.height === 'number') {
      inline.style.height = Math.max(120, Math.ceil(d.height)) + 'px'
    } else if (d.type === 'intelform:close' && popup) {
      close()
    } else if (d.type === 'intelform:redirect' && typeof d.url === 'string' && /^https?:\/\//i.test(d.url)) {
      location.href = d.url
    }
  })

  function style(b) {
    var c = b.getAttribute('data-color')
    if (c && /^#[0-9a-f]{3,8}$/i.test(c) && !b.style.backgroundColor) b.style.backgroundColor = c
  }
  var buttons = document.querySelectorAll('[data-intelform-popup]')
  for (var i = 0; i < buttons.length; i++) style(buttons[i])

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-intelform-popup]')
    if (!b) return
    e.preventDefault()
    open(b.getAttribute('data-intelform-popup'), b)
  })
})()

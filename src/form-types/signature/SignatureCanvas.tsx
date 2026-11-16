import {useEffect, useRef, useState} from 'react';
import SignaturePad from 'signature_pad';

import type {FieldRendererProps} from '../../respondent/types';
import {TextInput} from '../../respondent/ui';
import {cx} from '../../respondent/util';
import {FtIcon} from '../_respondent/icons';

/**
 * Signature (a lazy chunk: signature_pad). Draw with a pointer, or type your name for a
 * keyboard alternative (WCAG 2.1.1); either way the answer is `{url: 'data:image/png;base64,…'}`.
 * At submit the respondent page uploads each drawn signature straight to storage
 * (prepareSignatureAnswers → uploadSignature, src/respondent/upload.ts) and sends
 * `{fileId, token}` instead, since the Site API body limit can't carry the image.
 * Dark ink on a light "paper" in every theme, so the stored image reads anywhere.
 */
const MAX_RATIO = 2;

/** The pen colour: the stylesheet's `--ft-signature-ink` on the pad, else near-black. */
function ink(el: Element): string {
  return getComputedStyle(el).getPropertyValue('--ft-signature-ink').trim() || '#211d2a';
}

export default function SignatureCanvas({value, onChange, labels, inputId, invalid, describedBy}: FieldRendererProps<'signature'>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typed, setTyped] = useState('');
  const signed = !!value && typeof value === 'object' && typeof (value as {url?: unknown}).url === 'string';
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const pad = new SignaturePad(canvas, {penColor: ink(canvas), minWidth: 0.8, maxWidth: 2.6});
    padRef.current = pad;
    pad.addEventListener('endStroke', () => onChangeRef.current({url: pad.toDataURL('image/png')}));
    const fit = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_RATIO);
      const {width, height} = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const data = pad.toData();
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.getContext('2d')!.scale(ratio, ratio);
      pad.clear();
      if (data.length) pad.fromData(data);
    };
    fit();
    const initial = (value as {url?: string} | undefined)?.url;
    if (initial?.startsWith('data:image/png')) void pad.fromDataURL(initial, {ratio: Math.min(window.devicePixelRatio || 1, MAX_RATIO)});
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      pad.off();
    };
    // Mount only: the pad owns the drawing after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    if (mode === 'type') pad.off();
    else pad.on();
  }, [mode]);

  const clear = () => {
    padRef.current?.clear();
    setTyped('');
    onChange(undefined);
  };

  const drawTyped = (text: string) => {
    setTyped(text);
    const canvas = canvasRef.current!;
    const pad = padRef.current!;
    pad.clear();
    if (!text.trim()) return onChange(undefined);
    const ctx = canvas.getContext('2d')!;
    const {width, height} = canvas.getBoundingClientRect();
    let size = Math.min(48, height * 0.45);
    const family = getComputedStyle(canvas).fontFamily;
    ctx.save();
    ctx.fillStyle = ink(canvas);
    ctx.textBaseline = 'middle';
    do {
      ctx.font = `italic 500 ${size}px ${family}`;
      size -= 2;
    } while (ctx.measureText(text).width > width - 32 && size > 12);
    ctx.fillText(text, 16, height / 2);
    ctx.restore();
    onChange({url: canvas.toDataURL('image/png')});
  };

  return (
    <div className="ft-signature">
      <div className="ft-signature-pad" data-invalid={invalid ? '' : undefined}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={signed ? labels.signed : labels.signHere}
          className={cx('ft-signature-canvas', mode === 'type' && 'ft-signature-canvas-typed')}
        />
        {!signed && mode === 'draw' && (
          <span aria-hidden className="ft-signature-line">
            {labels.signHere}
          </span>
        )}
      </div>
      {mode === 'type' && (
        <TextInput
          id={inputId}
          // Mounts only when the respondent switches to typing, so focus follows their choice.
          autoFocus
          autoComplete="name"
          aria-label={labels.typeToSign}
          aria-describedby={describedBy}
          value={typed}
          onValueChange={drawTyped}
        />
      )}
      <div className="ft-signature-actions">
        <button type="button" onClick={() => setMode(mode === 'draw' ? 'type' : 'draw')} className="ft-quiet-button">
          <FtIcon name={mode === 'draw' ? 'keyboard' : 'pen-line'} />
          {mode === 'draw' ? labels.typeInstead : labels.drawInstead}
        </button>
        <button
          type="button"
          id={mode === 'draw' ? inputId : undefined}
          onClick={clear}
          aria-describedby={mode === 'draw' ? describedBy : undefined}
          className="ft-quiet-button">
          <FtIcon name="eraser" />
          {labels.clear}
        </button>
      </div>
    </div>
  );
}

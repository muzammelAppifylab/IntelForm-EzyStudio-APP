import {type ComponentType, createElement, lazy, Suspense} from 'react';

import type {FieldType} from '../lib/intelform/form/field-types';
import type {FieldRendererProps} from '../respondent/types';
import type {RendererRegistry} from './types';
import './respondent.css';

export type {FieldRendererProps} from '../respondent/types';
export {isGroupField} from '../respondent/types';

/**
 * Every type's input is its own chunk, fetched when a form uses it: a public form downloads the
 * inputs it shows. `preloadFieldRenderers` starts them before the form draws (the respondent
 * calls it with the schemas, src/respondent/FormRenderer.tsx), so the fallback rarely shows.
 */
const LOADERS: {[K in FieldType]: () => Promise<{default: ComponentType<FieldRendererProps<K>>}>} = {
  email: () => import('./email/Renderer'),
  name: () => import('./name/Renderer'),
  phone: () => import('./phone/Renderer'),
  address: () => import('./address/Renderer'),
  country: () => import('./country/Renderer'),
  short_text: () => import('./short_text/Renderer'),
  long_text: () => import('./long_text/Renderer'),
  number: () => import('./number/Renderer'),
  url: () => import('./url/Renderer'),
  date: () => import('./date/Renderer'),
  time: () => import('./time/Renderer'),
  single_choice: () => import('./single_choice/Renderer'),
  multiple_choice: () => import('./multiple_choice/Renderer'),
  dropdown: () => import('./dropdown/Renderer'),
  yes_no: () => import('./yes_no/Renderer'),
  picture_choice: () => import('./picture_choice/Renderer'),
  rating: () => import('./rating/Renderer'),
  nps: () => import('./nps/Renderer'),
  signature: () => import('./signature/Renderer'),
  consent: () => import('./consent/Renderer'),
  section_break: () => import('./section_break/Renderer'),
};

const started = new Map<FieldType, Promise<unknown>>();

/** One fetch per type per page (a failed one is tried again next time). */
function load<K extends FieldType>(type: K) {
  let p = started.get(type) as ReturnType<(typeof LOADERS)[K]> | undefined;
  if (!p) {
    p = LOADERS[type]().catch(err => {
      started.delete(type);
      throw err;
    }) as ReturnType<(typeof LOADERS)[K]>;
    started.set(type, p);
  }
  return p;
}

/** Starts fetching the inputs of these types (never throws: the field's own load reports it). */
export function preloadFieldRenderers(types: Iterable<FieldType>): Promise<unknown> {
  return Promise.all([...new Set(types)].filter(t => t in LOADERS).map(t => load(t).catch(() => undefined)));
}

function onDemand<K extends FieldType>(type: K): ComponentType<FieldRendererProps<K>> {
  const Lazy = lazy(() => load(type));
  function OnDemand(props: FieldRendererProps<K>) {
    return createElement(Suspense, {fallback: createElement('div', {className: 'rf-field-loading', 'aria-busy': true})}, createElement(Lazy as ComponentType<FieldRendererProps<K>>, props));
  }
  return OnDemand;
}

/**
 * The respondent input of each field type. Plain elements with the respondent's `rf-*` and the
 * field types' `ft-*` classes (src/form-types/respondent.css), no dashboard kit, so the public
 * form stays light. Heavy inputs (phone, the date calendar, signature) load their libraries on
 * demand inside their own renderer.
 */
export const FIELD_RENDERERS = Object.fromEntries(
  (Object.keys(LOADERS) as FieldType[]).map(type => [type, onDemand(type)])
) as unknown as RendererRegistry;
/** Alias of FIELD_RENDERERS. */
export const respondentRenderers: RendererRegistry = FIELD_RENDERERS;

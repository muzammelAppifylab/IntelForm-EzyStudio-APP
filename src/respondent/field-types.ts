import type {FormDefinition} from '../lib/intelform/form/definition';
import type {FieldType} from '../lib/intelform/form/field-types';
import {coreRegistry, registerFieldTypes} from '../lib/intelform/form/types/registry-store';

/**
 * The field types' schemas (zod) for the respondent, loaded per form: only the groups the form
 * uses, each its own chunk, before the form renders (the logic and validation read them from
 * the registry store). The server and the builder load every type (../lib/intelform/form/logic.ts).
 */

type Group = 'contact' | 'basic' | 'choice' | 'rating' | 'advanced';

const GROUP_OF: Record<FieldType, Group> = {
  email: 'contact',
  name: 'contact',
  phone: 'contact',
  address: 'contact',
  country: 'contact',
  short_text: 'basic',
  long_text: 'basic',
  number: 'basic',
  url: 'basic',
  date: 'basic',
  time: 'basic',
  single_choice: 'choice',
  multiple_choice: 'choice',
  dropdown: 'choice',
  yes_no: 'choice',
  picture_choice: 'choice',
  rating: 'rating',
  nps: 'rating',
  signature: 'advanced',
  consent: 'advanced',
  section_break: 'advanced',
};

const LOAD: Record<Group, () => Promise<unknown>> = {
  contact: () =>
    import('../lib/intelform/form/types/contact').then(m => registerFieldTypes({email: m.email, name: m.name, phone: m.phone, address: m.address, country: m.country})),
  basic: () =>
    import('../lib/intelform/form/types/basic').then(m =>
      registerFieldTypes({short_text: m.short_text, long_text: m.long_text, number: m.number, url: m.url, date: m.date, time: m.time})
    ),
  choice: () =>
    import('../lib/intelform/form/types/choice').then(m =>
      registerFieldTypes({
        single_choice: m.single_choice,
        multiple_choice: m.multiple_choice,
        dropdown: m.dropdown,
        yes_no: m.yes_no,
        picture_choice: m.picture_choice,
      })
    ),
  rating: () => import('../lib/intelform/form/types/rating').then(m => registerFieldTypes({rating: m.rating, nps: m.nps})),
  advanced: () =>
    import('../lib/intelform/form/types/advanced').then(m => registerFieldTypes({signature: m.signature, consent: m.consent, section_break: m.section_break})),
};

const loading = new Map<Group, Promise<unknown>>();

/** True when every type of `def` is loaded (render now). */
export function fieldTypesReady(def: Pick<FormDefinition, 'fields'>): boolean {
  return def.fields.every(f => coreRegistry[f.type] !== undefined);
}

/** Loads the groups `def` uses (each once per page). Rejects when a chunk can't be fetched. */
export async function loadFieldTypes(def: Pick<FormDefinition, 'fields'>): Promise<void> {
  const groups = new Set(def.fields.map(f => GROUP_OF[f.type]).filter(Boolean));
  await Promise.all(
    [...groups].map(g => {
      let p = loading.get(g);
      if (!p) {
        p = LOAD[g]().catch(err => {
          loading.delete(g);
          throw err;
        });
        loading.set(g, p);
      }
      return p;
    })
  );
}

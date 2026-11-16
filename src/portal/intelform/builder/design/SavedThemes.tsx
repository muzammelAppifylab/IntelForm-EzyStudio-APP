import {queryOptions, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useRef, useState} from 'react';

import {saveThemeInput, type SavedTheme, type SavedThemesResponse} from '../../../../lib/intelform/api-builder';
import {Button, IconButton, Spinner, useConfirm, useToast} from '../../../ui';
import {api, errorMessage, firstFieldErrors} from '../../lib/api';
import {useBuilder, useBuilderStore} from '../store';
import {TextRow} from '../settings/shared';
import {DesignSection} from './bits';
import {swatchVars, useCssVars} from './theme-edit';

/** `/site-api/themes`: themes saved by anyone on the team, newest first. */
export const themesKey = ['intelform', 'themes'] as const;
export const savedThemesQuery = queryOptions({
  queryKey: themesKey,
  queryFn: () => api<SavedThemesResponse>('/site-api/themes'),
  staleTime: 30_000,
});

/** Save this design to reuse it on other forms; apply or delete the saved ones. */
export function SavedThemes() {
  const store = useBuilderStore();
  const readOnly = useBuilder(s => s.readOnly);
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const themes = useQuery(savedThemesQuery);

  const save = useMutation({
    mutationFn: (input: {name: string}) =>
      api<SavedTheme>('/site-api/themes', {method: 'POST', body: {name: input.name, settings: store.getState().doc.theme}}),
    onSuccess: () => {
      toast.success('Theme saved');
      setName('');
      void queryClient.invalidateQueries({queryKey: themesKey});
    },
    onError: err => setError(firstFieldErrors(err).name ?? errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/site-api/themes/${encodeURIComponent(id)}`, {method: 'DELETE'}),
    onSuccess: () => {
      toast.success('Theme deleted');
      void queryClient.invalidateQueries({queryKey: themesKey});
    },
  });

  return (
    <DesignSection title="Saved themes" description="Save this design to reuse it on other forms.">
      {!readOnly && (
        <form
          className="if-inline-form"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            const parsed = saveThemeInput.shape.name.safeParse(name);
            if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Enter a name for the theme');
            setError(null);
            save.mutate({name: parsed.data});
          }}>
          <TextRow
            label="Theme name"
            value={name}
            maxLength={80}
            placeholder="e.g. Acme brand"
            error={error}
            onChange={v => (setName(v), setError(null))}
          />
          <Button type="submit" variant="secondary" size="sm" icon="save" pending={save.isPending} pendingLabel="Saving…">
            Save
          </Button>
        </form>
      )}
      {themes.isPending ? (
        <Spinner label="Loading saved themes…" showLabel />
      ) : themes.isError ? (
        <p className="field-error">{errorMessage(themes.error)}</p>
      ) : themes.data.themes.length ? (
        <ul className="if-saved-themes" aria-label="Saved themes">
          {themes.data.themes.map(t => (
            <li key={t.id}>
              <SavedThemeSwatch theme={t} />
              <span className="if-saved-name">{t.name}</span>
              {!readOnly && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      store.getState().commit(`Apply ${t.name}`, d => void (d.theme = structuredClone(t.settings)));
                      toast.success(`${t.name} applied`);
                    }}>
                    Apply
                  </Button>
                  <IconButton
                    icon="trash"
                    size="sm"
                    label={`Delete ${t.name}`}
                    onClick={() =>
                      void confirm({
                        title: `Delete “${t.name}”?`,
                        body: 'Forms that use it keep their design; it just leaves this list.',
                        confirmLabel: 'Delete theme',
                        action: () => remove.mutateAsync(t.id),
                      })
                    }
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="if-row-hint">No saved themes yet.</p>
      )}
    </DesignSection>
  );
}

function SavedThemeSwatch({theme}: {theme: SavedTheme}) {
  const ref = useRef<HTMLSpanElement>(null);
  useCssVars(ref, swatchVars(theme.settings));
  return (
    <span ref={ref} className="if-mini-swatch" aria-hidden="true">
      <span className="if-dot if-dot-bg" />
      <span className="if-dot if-dot-question" />
      <span className="if-dot if-dot-button" />
    </span>
  );
}

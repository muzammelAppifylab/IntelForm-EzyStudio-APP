import {useConfirm, useToast} from '../../ui';
import {useDeleteResponses} from '../queries/responses';
import {deleteCopy} from './state';

/**
 * `const askDelete = useConfirmDelete(formId); if (await askDelete(ids)) …`: the kit's confirm
 * dialog (pending while the request runs, errors shown in it), then a toast. Resolves true once
 * the responses are gone (legacy ConfirmDelete.tsx).
 */
export function useConfirmDelete(formId: string) {
  const confirm = useConfirm();
  const toast = useToast();
  const del = useDeleteResponses(formId);
  return async (ids: string[]): Promise<boolean> => {
    if (!ids.length) return false;
    let deleted = 0;
    const ok = await confirm({
      ...deleteCopy(ids.length),
      pendingLabel: 'Deleting…',
      action: async () => {
        deleted = (await del.mutateAsync(ids)).deleted;
      },
    });
    if (ok) toast.success(deleted === 1 ? 'Response deleted.' : `${deleted} responses deleted.`);
    return ok;
  };
}

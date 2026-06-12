import { useCallback, useRef } from 'react';
import { saveCurrentDraft } from '../../../lib/storage';
import type { ContentDraft } from '@51publisher/shared';

interface UseAutoSaveReturn {
  saveDraft: (draft: ContentDraft, immediate?: boolean) => void;
}

export function useAutoSave(delay = 1000): UseAutoSaveReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveDraft = useCallback(
    (draft: ContentDraft, immediate = false) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      const doSave = () => {
        saveCurrentDraft(draft).catch(console.error);
      };

      if (immediate) {
        doSave();
      } else {
        timerRef.current = setTimeout(doSave, delay);
      }
    },
    [delay],
  );

  return { saveDraft };
}
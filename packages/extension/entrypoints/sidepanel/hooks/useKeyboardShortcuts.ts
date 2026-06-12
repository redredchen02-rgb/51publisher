import { useEffect } from 'react';

interface KeyboardShortcutsOptions {
  onGenerate?: () => void;
  onFill?: () => void;
  onNext?: () => void;
  onSave?: () => void;
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const modifier = event.ctrlKey || event.metaKey;

      // Ctrl/Cmd + Enter: 生成草稿
      if (modifier && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        options.onGenerate?.();
        return;
      }

      // Ctrl/Cmd + Shift + Enter: 填充到当前页
      if (modifier && event.shiftKey && event.key === 'Enter') {
        event.preventDefault();
        options.onFill?.();
        return;
      }

      // Ctrl/Cmd + ArrowRight: 下一条
      if (modifier && event.key === 'ArrowRight') {
        event.preventDefault();
        options.onNext?.();
        return;
      }

      // Ctrl/Cmd + S: 保存
      if (modifier && event.key === 's') {
        event.preventDefault();
        options.onSave?.();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [options]);
}

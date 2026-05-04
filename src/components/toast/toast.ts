import { useMemo } from 'react';
import { useToast, type ToastInput, type ToastVariant } from './ToastProvider';

type ToastApi = {
  show: (t: ToastInput) => void;
  info: (message: string, title?: string, opts?: Partial<ToastInput>) => void;
  success: (message: string, title?: string, opts?: Partial<ToastInput>) => void;
  warning: (message: string, title?: string, opts?: Partial<ToastInput>) => void;
  error: (message: string, title?: string, opts?: Partial<ToastInput>) => void;
  dismiss: () => void;
};

function makePreset(
  show: (t: ToastInput) => void,
  variant: ToastVariant,
  defaultDurationMs: number,
) {
  return (message: string, title?: string, opts?: Partial<ToastInput>) =>
    show({
      title,
      message,
      variant,
      durationMs: opts?.durationMs ?? defaultDurationMs,
    });
}

/**
 * API “premium” para toasts: presets + defaults consistentes.
 * (Evita repetir variant/duration y reduce ruido en pantallas.)
 */
export function useAppToast(): ToastApi {
  const t = useToast();

  return useMemo(
    () => ({
      show: t.show,
      dismiss: t.dismiss,
      info: makePreset(t.show, 'info', 2600),
      success: makePreset(t.show, 'success', 2600),
      warning: makePreset(t.show, 'warning', 4200),
      error: makePreset(t.show, 'error', 4200),
    }),
    [t.dismiss, t.show],
  );
}


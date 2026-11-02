// One toast at a time, bottom centre, 3.2 s (showToast in Index.html). <Toaster /> in the (app) layout draws it.
export const TOAST_EVENT = 'ht-toast';

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

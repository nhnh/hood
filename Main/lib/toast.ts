export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

let toastId = 0;
let listeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];

export function showToast(message: string, type: ToastType = 'info') {
    const id = ++toastId;
    toasts = [...toasts, { id, message, type }];
    listeners.forEach(l => l(toasts));
    setTimeout(() => {
        toasts = toasts.filter(t => t.id !== id);
        listeners.forEach(l => l(toasts));
    }, 4000);
}

export function subscribe(listener: (toasts: Toast[]) => void) {
    listeners.push(listener);
    return () => {
        listeners = listeners.filter(l => l !== listener);
    };
}

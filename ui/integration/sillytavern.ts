// Safe SillyTavern integration helpers

export interface STEventSource {
  on(event: string, handler: (data: unknown) => void): void;
}

export interface STContext {
  eventSource: STEventSource;
}

export interface STGlobal {
  getContext?: () => STContext | null;
}

declare global {
  interface Window { SillyTavern?: STGlobal }
}

export function getSTContext(): STContext | null {
  try {
    return window.SillyTavern?.getContext?.() ?? null;
  } catch (_) {
    return null;
  }
}


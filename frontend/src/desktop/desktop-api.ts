export interface DesktopCloseRequest {
  readonly reason: "quit" | "window";
  readonly requestId: number;
}

export type DesktopCloseDecision = "approve" | "cancel";

export interface DesktopSaveResult {
  readonly status: "cancelled" | "saved";
}

export interface BlissHackDesktopApi {
  readonly apiVersion: 1;
  onCloseRequested(
    listener: (request: DesktopCloseRequest) => void,
  ): () => void;
  respondToClose(
    requestId: number,
    decision: DesktopCloseDecision,
  ): Promise<void>;
  saveFile(fileName: string, data: ArrayBuffer): Promise<DesktopSaveResult>;
}

declare global {
  interface Window {
    readonly blisshackDesktop?: BlissHackDesktopApi;
  }
}

/** Return the narrow preload API when running in the Electron renderer. */
export function getDesktopApi(): BlissHackDesktopApi | null {
  if (typeof window === "undefined") return null;
  const api = window.blisshackDesktop;
  return api?.apiVersion === 1 ? api : null;
}

/// <reference types="vite/client" />

interface RequestInit {
  duplex?: "half" | "full";
}

// injected by vite define (see vite.config.ts)
declare const __APP_VERSION__: string;


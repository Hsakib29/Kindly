// Shared message contract between content script, options page, and service worker.
// Every message and response is typed here so malformed payloads fail at compile time.

export type ToneId =
  | 'professional'
  | 'warm'
  | 'short'
  | 'direct'
  | 'empathetic'
  | 'friendly'
  | 'grammar';

export const TONE_IDS: readonly ToneId[] = [
  'professional',
  'warm',
  'short',
  'direct',
  'empathetic',
  'friendly',
  'grammar',
];

export interface Variant {
  label: string;
  text: string;
}

export type ErrorCode =
  | 'INVALID_KEY'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'SAFETY_BLOCK'
  | 'BAD_OUTPUT'
  | 'NO_KEY'
  | 'TEXT_TOO_SHORT'
  | 'TEXT_TOO_LONG'
  | 'TIMEOUT';

export interface ApiError {
  code: ErrorCode;
  message: string;
  retryAfterMs?: number;
}

// ---- Requests (sent to the service worker) ----

/** Structured page context built in code before the prompt (Q2). */
export interface ContextBriefData {
  platform: string;
  title?: string;
  /** The message the user is replying to (capped, keeps the end). */
  replyTarget?: string;
  /** Sender/other-party name when known. */
  otherParty?: string;
  /** Coarse language hint for reply_target ('en'|'ja'|'bn'|'other'). */
  replyLanguage?: string;
  /** Coarse language hint for the user's draft. */
  draftLanguage?: string;
  /** Short trimmed earlier turns (last few, each capped). */
  earlierMessages?: string[];
  /** Full cleaned context fallback when no reply_target exists. */
  contextText?: string;
}

export type ExtensionRequest =
  | { type: 'PING' }
  | { type: 'VERIFY_KEY'; key: string }
  | {
      type: 'REWRITE';
      requestId: string;
      text: string;
      tone: ToneId;
      instruction?: string;
      avoid?: string[];
      /** Extracted page context (untrusted data) when enabled. */
      context?: string;
      /** Structured context brief (preferred over `context`). */
      brief?: ContextBriefData;
    }
  | {
      type: 'WRITE';
      requestId: string;
      prompt: string;
      tone?: ToneId;
      length?: 'short' | 'medium' | 'long';
      instruction?: string;
      /** Extracted page context — exactly what the preview showed. */
      context?: string;
      /** Existing draft to revise (follow-up instructions). */
      draft?: string;
      /** Structured context brief. */
      brief?: ContextBriefData;
    }
  | { type: 'CANCEL'; requestId: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  | { type: 'OPEN_OPTIONS' };

// ---- Responses (sent back to the requester) ----

export type ExtensionResponse =
  | { type: 'PONG' }
  | { type: 'VERIFY_KEY_RESULT'; ok: boolean; modelCount?: number; error?: ApiError }
  | { type: 'REWRITE_RESULT'; requestId: string; variants: Variant[]; model?: string }
  | { type: 'WRITE_RESULT'; requestId: string; variants: Variant[]; model?: string }
  | { type: 'ERROR'; requestId?: string; error: ApiError }
  | { type: 'SETTINGS'; settings: Settings };

// ---- Settings (P1.2 storage schema; extended in later stages) ----

export interface BrandVoice {
  companyName?: string;
  greeting?: string;
  closing?: string;
  wordsToUse?: string[];
  wordsToAvoid?: string[];
  formality?: 'casual' | 'neutral' | 'formal';
}

export interface Settings {
  schemaVersion: number;
  hiddenSites: string[];
  neverRunSites: string[];
  brandVoice: BrandVoice;
  routerPreference: 'auto' | 'speed' | 'quality';
  usePageContextBySite: Record<string, boolean>;
  /** Developer: log request/context details to consoles. Default off. */
  debug: boolean;
}

export const SETTINGS_DEFAULTS: Settings = {
  schemaVersion: 1,
  hiddenSites: [],
  neverRunSites: [],
  brandVoice: {},
  routerPreference: 'auto',
  usePageContextBySite: {},
  debug: false,
};

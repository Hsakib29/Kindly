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
  /** Fixed role assigned by the prompt ('short'|'balanced'|'detailed'|...). */
  role?: string;
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
  | 'TIMEOUT'
  | 'KEY_LOCKED';

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
      /** Custom tone preset instruction (P7.2). */
      customToneInstruction?: string;
      /** Brand voice settings (P7.1). */
      brandVoice?: BrandVoice;
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
      /** Custom tone preset instruction (P7.2). */
      customToneInstruction?: string;
      /** Brand voice settings (P7.1). */
      brandVoice?: BrandVoice;
      /** Saved reply to attach as knowledge (P7.4). */
      savedReply?: SavedReply;
    }
  | { type: 'CANCEL'; requestId: string }
  | { type: 'GET_SITE_INFO' }
  | { type: 'GET_USAGE' }
  | { type: 'GET_KEY_STATE' }
  | { type: 'ENCRYPT_KEY'; passphrase: string }
  | { type: 'UNLOCK_KEY'; passphrase: string }
  | { type: 'LOCK_KEY' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  | { type: 'OPEN_OPTIONS' };

// ---- Responses (sent back to the requester) ----

export type ExtensionResponse =
  | { type: 'PONG' }
  | { type: 'VERIFY_KEY_RESULT'; ok: boolean; modelCount?: number; error?: ApiError }
  | { type: 'REWRITE_RESULT'; requestId: string; variants: Variant[]; model?: string; mode?: string }
  | { type: 'WRITE_RESULT'; requestId: string; variants: Variant[]; model?: string; mode?: string }
  | { type: 'ERROR'; requestId?: string; error: ApiError }
  | { type: 'SETTINGS'; settings: Settings }
  | { type: 'SITE_INFO'; hostname: string; hidden: boolean }
  | { type: 'USAGE'; day: string; count: number }
  | { type: 'KEY_STATE'; protected: boolean; unlocked: boolean };

// ---- Settings (P1.2 storage schema; extended in later stages) ----

export interface BrandVoice {
  companyName?: string;
  greeting?: string;
  closing?: string;
  wordsToUse?: string[];
  wordsToAvoid?: string[];
  formality?: 'casual' | 'neutral' | 'formal';
}

export interface CustomTone {
  id: string;
  name: string;
  /** Free-text style instruction applied when the preset is picked. */
  instruction: string;
  pinned: boolean;
}

export interface SavedReply {
  id: string;
  title: string;
  /** The exact wording Gemini should reuse. */
  text: string;
}

export interface Settings {
  schemaVersion: number;
  hiddenSites: string[];
  neverRunSites: string[];
  brandVoice: BrandVoice;
  customTones: CustomTone[];
  savedReplies: SavedReply[];
  routerPreference: 'auto' | 'speed' | 'quality';
  usePageContextBySite: Record<string, boolean>;
  /** Developer: log request/context details to consoles. Default off. */
  debug: boolean;
}

/** Default never-run hostnames (banking/health) — editable in options. */
export const DEFAULT_NEVER_RUN_SITES = [
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'citibank.com',
  'capitalone.com',
  'americanexpress.com',
  'paypal.com',
  'venmo.com',
  'mychart.com',
  'mychart.org',
  'followmyhealth.com',
];

export const SETTINGS_DEFAULTS: Settings = {
  schemaVersion: 1,
  hiddenSites: [],
  neverRunSites: [],
  brandVoice: {},
  customTones: [],
  savedReplies: [],
  routerPreference: 'auto',
  usePageContextBySite: {},
  debug: false,
};

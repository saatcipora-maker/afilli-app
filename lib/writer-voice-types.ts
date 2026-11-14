import type { WriterVoiceInputMimeType } from '@workspace/api-client-react';

export const VOICE_MAX_SECONDS = 60;
export const VOICE_MAX_BYTES = 8 * 1024 * 1024;
export type Clip = { base64: string; mimeType: WriterVoiceInputMimeType; bytes: number; seconds: number };
export class VoiceError extends Error {
  constructor(public code: 'denied' | 'unsupported' | 'too-large' | 'failed', message: string) { super(message); }
}
export type Recorder = { supported: boolean; recording: boolean; seconds: number; start: () => Promise<void>; stop: () => Promise<Clip>; cancel: () => void };

import type { components } from './schema';

/** Pydantic marks every field with a default as optional in the *input* schema, but the server always
 *  sends them all. Reading types are made complete here, once. */
export type DeepRequired<T> = T extends object ? { [K in keyof T]-?: DeepRequired<T[K]> } : T;

export type Score = DeepRequired<components['schemas']['Score']>;
export type AssemblyParams = DeepRequired<components['schemas']['AssemblyParams']>;
export type Slot = Score['measures'][number]['slots'][number];
export type ScoreNote = Slot['notes'][number];
export type Tuning = Score['assembly_params']['tuning'];
export type AnalysisOptions = components['schemas']['AnalysisOptions'];
export type CreateTranscription = components['schemas']['CreateTranscription'];
export type ReassembleIn = components['schemas']['ReassembleIn'];

/** A take kept in your test set (data/truth): checked note by note. */
export interface TruthInfo {
  revision: number;
  created_at: string;
  notes: number;
  added_notes: number;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  attempts: number;
  worker_target: string;
  worker: string | null;
  transcription_id: string;
}

export interface AssetInfo {
  asset_id: string;
  kind: 'audio' | 'video';
  filename: string;
  size: number;
  duration_s: number;
  sha256: string;
  role?: 'wet' | 'di' | 'video';
}

export interface Quality {
  voiced_ratio: number;
  low_confidence_note_ratio: number;
  clipping: boolean;
  warnings: string[];
  separation?: { used: boolean; stem: string; reason: string; backing_db?: number } | null;
  video?: { used: boolean; reason?: string; frames?: number; hands_ratio?: number; notes_with_evidence?: number; tracked_ratio?: number } | null;
  key?: { name: string; tonic: number; mode: 'major' | 'minor'; margin: number; scale_prior: boolean } | null;
}

export interface Transcription {
  id: string;
  project_id: string;
  title: string;
  analysis_id: string | null;
  current_revision: number;
  created_at: string;
  status: 'ready' | 'empty' | JobStatus;
  job: JobSnapshot | null;
  assembly_params: AssemblyParams;
  score?: Score;
  revision_source?: 'auto' | 'reassemble' | 'user';
  quality?: Quality | null;
  inputs: AssetInfo[];
}

export interface Worker {
  id: string;
  location: string;
  capabilities: Record<string, unknown>;
  last_seen: string;
}

export interface RevisionInfo {
  number: number;
  source: string;
  created_at: string;
}

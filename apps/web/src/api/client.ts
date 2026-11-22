import { ApiError, getJSON, sendJSON } from './http';
import type { VideoTrack } from '../lib/neckTrack';
import { getT } from '../i18n';
import type { AssetInfo, CreateTranscription, ReassembleIn, RevisionInfo, Score, Transcription, TruthInfo, Worker } from './types';

/** Every endpoint the SPA calls, in one place: components never build `/api/v1` URLs themselves. */
const V = '/api/v1';

export type UploadedAsset = AssetInfo & { project_id: string };

export const urls = {
  assetContent: (assetId: string) => `${V}/assets/${assetId}/content`,
  frame: (assetId: string, t: number) => `${V}/assets/${assetId}/frame?t=${t}`,
  stem: (id: string, role: 'guitar' | 'backing', analysisId: string) => `${V}/transcriptions/${id}/stems/${role}?a=${analysisId}`,
  export: (id: string, format: string) => `${V}/transcriptions/${id}/export?format=${format}`,
  jobEvents: (jobId: string) => `${V}/jobs/${jobId}/events`,
};

export const api = {
  transcription: (id: string, signal?: AbortSignal) => getJSON<Transcription>(`${V}/transcriptions/${id}`, signal),
  transcriptions: (signal?: AbortSignal) => getJSON<Transcription[]>(`${V}/transcriptions`, signal),
  revisions: (id: string, signal?: AbortSignal) => getJSON<RevisionInfo[]>(`${V}/transcriptions/${id}/revisions`, signal),
  workers: (signal?: AbortSignal) => getJSON<Worker[]>(`${V}/workers`, signal),
  /** where the video stage saw the neck; `analysisId` keys the browser cache to this analysis */
  videoTrack: (id: string, analysisId: string, signal?: AbortSignal) =>
    getJSON<VideoTrack>(`${V}/transcriptions/${id}/video-track?a=${analysisId}`, signal),

  create: (projectId: string, body: CreateTranscription) =>
    sendJSON<{ transcription_id: string; job_id: string | null; cached: boolean }>('POST', `${V}/projects/${projectId}/transcriptions`, body),
  save: (id: string, score: Score) => sendJSON<Transcription>('PUT', `${V}/transcriptions/${id}`, score),
  reassemble: (id: string, body: ReassembleIn) => sendJSON<Transcription>('POST', `${V}/transcriptions/${id}/reassemble`, body),
  restore: (id: string, n: number) => sendJSON<Transcription>('POST', `${V}/transcriptions/${id}/revisions/${n}/restore`),
  analyseWithVideo: (id: string, calibration: {
    t_s: number; points: [number, number][]; fret_a: number; fret_b: number;
    frets?: number[]; guitar?: 'electric' | 'acoustic' | 'classical' | 'parallel';
  }) =>
    sendJSON<{ job_id: string }>('POST', `${V}/transcriptions/${id}/video`, { calibration }),
  cancelJob: (jobId: string) => sendJSON('POST', `${V}/jobs/${jobId}/cancel`),
  truth: (id: string, signal?: AbortSignal) => getJSON<TruthInfo | null>(`${V}/transcriptions/${id}/truth`, signal),
  saveTruth: (id: string) => sendJSON<TruthInfo>('PUT', `${V}/transcriptions/${id}/truth`),
  deleteTruth: (id: string) => sendJSON<void>('DELETE', `${V}/transcriptions/${id}/truth`),

  /** alphaTex of a (possibly unsaved) score, for the live score view. */
  alphatex: async (score: Score, signal?: AbortSignal) => {
    const r = await fetch(`${V}/alphatex`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(score), signal });
    if (!r.ok) throw new ApiError(r.status, r.statusText);
    return r.text();
  },

  /** Multipart upload with progress (fetch cannot report upload progress, XHR can). */
  upload: (file: File, onProgress: (frac: number) => void) =>
    new Promise<UploadedAsset>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${V}/uploads`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body: { detail?: string; code?: string; params?: Record<string, string | number> } & Partial<UploadedAsset> = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* not json */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadedAsset);
        else reject(new ApiError(xhr.status, body.detail ?? getT().errors.upload(xhr.status), body.code ?? null, body.params ?? {}));
      };
      xhr.onerror = () => reject(new Error(getT().errors.connection));
      const fd = new FormData();
      fd.append('file', file);
      xhr.send(fd);
    }),
};

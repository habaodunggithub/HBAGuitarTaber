import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, urls } from './client';
import { ApiError } from './http';
import type { JobSnapshot, ReassembleIn } from './types';

export const keys = {
  transcription: (id: string) => ['transcription', id] as const,
  list: ['transcriptions'] as const,
  workers: ['workers'] as const,
  revisions: (id: string) => ['revisions', id] as const,
  truth: (id: string) => ['truth', id] as const,
};

export const useTranscription = (id: string) =>
  useQuery({ queryKey: keys.transcription(id), queryFn: ({ signal }) => api.transcription(id, signal) });

/** Warm the cache before navigating, so the editor opens with its data. */
export const prefetchTranscription = (qc: QueryClient, id: string) =>
  qc.prefetchQuery({ queryKey: keys.transcription(id), queryFn: ({ signal }) => api.transcription(id, signal) });

export const useTranscriptions = () =>
  useQuery({ queryKey: keys.list, queryFn: ({ signal }) => api.transcriptions(signal) });

export const useWorkers = () =>
  useQuery({ queryKey: keys.workers, queryFn: ({ signal }) => api.workers(signal), refetchInterval: 5000 });

/** The video stage's neck tracking (null: this analysis has none, e.g. made before the overlay existed). */
export const useVideoTrack = (id: string, analysisId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ['video-track', id, analysisId] as const,
    enabled: enabled && !!analysisId,
    staleTime: Infinity, // an analysis never changes
    retry: false,
    queryFn: ({ signal }) =>
      api.videoTrack(id, analysisId!, signal).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
  });

export const useRevisions =(id: string, enabled = true) =>
  useQuery({ queryKey: keys.revisions(id), enabled, queryFn: ({ signal }) => api.revisions(id, signal) });

/** Whether this take is in your test set, and the actions to add, refresh or remove it. */
export function useTruth(id: string) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.truth(id), queryFn: ({ signal }) => api.truth(id, signal) });
  const set = (v: Awaited<ReturnType<typeof api.truth>>) => qc.setQueryData(keys.truth(id), v);
  const save = useMutation({ mutationFn: () => api.saveTruth(id), onSuccess: set });
  const remove = useMutation({ mutationFn: () => api.deleteTruth(id), onSuccess: () => set(null) });
  return { info: q.data ?? null, save, remove };
}

/** Replaces the cached transcription with the server's answer and refreshes revision history. */
function useApply(id: string) {
  const qc = useQueryClient();
  return (t: Awaited<ReturnType<typeof api.transcription>>) => {
    qc.setQueryData(keys.transcription(id), t);
    void qc.invalidateQueries({ queryKey: keys.revisions(id) });
  };
}

export function useReassemble(id: string) {
  const apply = useApply(id);
  return useMutation({ mutationFn: (body: ReassembleIn) => api.reassemble(id, body), onSuccess: apply });
}

export function useRestore(id: string) {
  const apply = useApply(id);
  return useMutation({ mutationFn: (n: number) => api.restore(id, n), onSuccess: apply });
}

export interface JobProgress {
  status: JobSnapshot['status'] | 'connecting';
  stage: string;
  progress: number;
  message: string;
  error: string | null;
}

/** Live job progress over SSE. Calls onDone once when the job finishes successfully. */
export function useJobEvents(jobId: string | null, onDone: () => void): JobProgress {
  const [state, setState] = useState<JobProgress>({ status: 'connecting', stage: '', progress: 0, message: '', error: null });
  useEffect(() => {
    if (!jobId) return;
    setState({ status: 'connecting', stage: '', progress: 0, message: '', error: null });
    const es = new EventSource(urls.jobEvents(jobId));
    const parse = (e: Event) => JSON.parse((e as MessageEvent).data as string) as Record<string, unknown>;
    es.addEventListener('snapshot', (e) => {
      const d = parse(e) as unknown as JobSnapshot;
      setState({ status: d.status, stage: d.stage, progress: d.progress, message: d.message, error: d.error });
    });
    es.addEventListener('progress', (e) => {
      const d = parse(e) as { stage: string; progress: number; message: string };
      setState((s) => ({ ...s, status: 'running', stage: d.stage, progress: d.progress, message: d.message }));
    });
    es.addEventListener('done', () => {
      setState((s) => ({ ...s, status: 'succeeded', progress: 1 }));
      es.close();
      onDone();
    });
    es.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data as string | undefined;
      if (data) {
        const d = JSON.parse(data) as { error?: string; canceled?: boolean };
        setState((s) => ({ ...s, status: d.canceled ? 'canceled' : 'failed', error: d.error ?? 'Error' }));
        es.close();
      } // else: transient connection error, EventSource retries by itself
    });
    return () => es.close();
    // onDone intentionally not a dependency: callers pass a fresh closure each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  return state;
}

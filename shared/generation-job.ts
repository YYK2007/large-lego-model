export type JobProgress = {
  stage: 'researching' | 'outlining' | 'comparing-outline' | 'selecting-parts' | 'planning' | 'checking' | 'comparing' | 'repairing';
  attempt: number;
  maxAttempts: number;
  detail?: string;
  candidate?: number;
};
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type JobAttempt = {
  attempt: number;
  status: 'invalid' | 'valid';
  checks: string[];
  previewAvailable: boolean;
  partial?: boolean;
  designId?: string;
  at: string;
};
export type GenerationJob = {
  id: string;
  status: JobState;
  quality: 'quick' | 'detailed';
  continuous?: boolean;
  stopWhenMatched?: boolean;
  attempts?: JobAttempt[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: JobProgress;
  usage?: GenerationUsage;
  milestones: (JobProgress & { at: string })[];
  bestDraftId?: string;
  conceptId?: string;
  resultId?: string;
  error?: { message: string; checks: string[] };
  resumedFrom?: string;
  resumeMode?: 'draft' | 'original';
};
export const isActiveJob = (job: Pick<GenerationJob, 'status'>) => job.status === 'queued' || job.status === 'running';
export const jobStageLabels: Record<JobProgress['stage'], string> = {
  researching: 'Finding reference photos', outlining: 'Outlining the build', 'comparing-outline': 'Checking the outline',
  'selecting-parts': 'Selecting real parts', planning: 'Planning the build', checking: 'Checking brick connections',
  comparing: 'Comparing with reference photos', repairing: 'Refining the design',
};
import type { GenerationUsage } from '../server/generation';


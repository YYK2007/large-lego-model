import type { BuildStep } from '../shared/model';

export type BuildProgress = { step: number; piece: number; completed: boolean };
export function readBuildProgress(value: string | null, steps: BuildStep[]): BuildProgress {
  try {
    const saved = JSON.parse(value ?? 'null');
    if (Number.isInteger(saved?.step) && steps[saved.step] && Number.isInteger(saved.piece) && steps[saved.step].bricks[saved.piece]) {
      return { step: saved.step, piece: saved.piece, completed: saved.completed === true && saved.step === steps.length - 1 && saved.piece === steps.at(-1)!.bricks.length - 1 };
    }
  } catch { /* Browser storage can be unavailable; building still works. */ }
  return { step: 0, piece: 0, completed: false };
}
export function moveBuildProgress(progress: BuildProgress, steps: BuildStep[], direction: -1 | 1): BuildProgress {
  const nextPiece = progress.piece + direction;
  if (nextPiece >= 0 && nextPiece < steps[progress.step].bricks.length) return { ...progress, piece: nextPiece, completed: false };
  const nextStep = progress.step + direction;
  if (nextStep >= 0 && nextStep < steps.length) return { step: nextStep, piece: direction > 0 ? 0 : steps[nextStep].bricks.length - 1, completed: false };
  return { ...progress, completed: direction > 0 };
}

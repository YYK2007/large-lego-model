import dotenv from 'dotenv';

export function readConfig() {
  dotenv.config({ quiet: true, override: true });
  return {
    geminiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    rebrickableKey: process.env.REBRICKABLE_API_KEY || '',
    photonReady: Boolean(process.env.SPECTRUM_PROJECT_ID && process.env.SPECTRUM_PROJECT_SECRET),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  };
}

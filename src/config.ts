import { DEFAULT_FLIGHT, type FlightSettings } from './sim/drone';

/** Pilot-facing settings, persisted in localStorage (design.md §9, R8.1–R8.2). */
export interface Settings {
  /** FPV camera uptilt, degrees (0–60). */
  cameraTilt: number;
  /** Horizontal field of view, degrees. */
  fovH: number;
  /** Upper bound for the dynamic render scale (1 = 1280×720). */
  maxRenderScale: number;
  /** Right stick up = nose up (flight-sim style) instead of the FPV-standard nose down. */
  invertPitch: boolean;
  flight: FlightSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  cameraTilt: 30,
  fovH: 110,
  maxRenderScale: 1,
  invertPitch: false,
  flight: DEFAULT_FLIGHT,
};

const KEY = 'fpvsim.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...s,
      flight: { ...DEFAULT_FLIGHT, ...s.flight },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: settings last for this session
  }
}

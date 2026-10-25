import type {
  Building,
  FootageResponse,
  ReviewBody,
  RunState,
  ScenariosResponse,
  Status,
} from './types';

// Relative base so the production build served by FastAPI (same origin) and the Vite dev proxy both work.
export const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (e) {
    throw new ApiError(0, 'Backend unreachable');
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === 'string') msg = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  status: () => request<Status>('/status'),
  building: () => request<Building>('/building'),
  scenarios: () => request<ScenariosResponse>('/scenarios'),
  footage: () => request<FootageResponse>('/footage'),
  previewUrl: (clipId: string, frame = 12) => `${API_BASE}/footage/${encodeURIComponent(clipId)}/preview.jpg?frame=${frame}`,
  startRun: (scenario_id: string, overrides: Record<string, string> = {}) =>
    request<{ run_id: string }>('/runs', json({ scenario_id, overrides })),
  currentRun: () => request<{ run: RunState | null }>('/runs/current'),
  getRun: (id: string) => request<RunState>(`/runs/${encodeURIComponent(id)}`),
  review: (id: string, body: ReviewBody) => request<{ ok: boolean }>(`/runs/${encodeURIComponent(id)}/review`, json(body)),
  cancel: (id: string) => request<{ ok: boolean }>(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ clip_id: string }>('/footage/upload', { method: 'POST', body: fd });
  },
};

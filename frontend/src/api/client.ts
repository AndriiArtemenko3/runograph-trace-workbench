/**
 * Tiny fetch wrapper. During local development, `/api/...` requests use the
 * Vite proxy (vite.config.ts) to http://127.0.0.1:8000. This repository does
 * not bundle the built SPA into FastAPI or define a production deployment.
 */
export async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

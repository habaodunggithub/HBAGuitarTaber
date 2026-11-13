export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parse<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let detail = r.statusText;
    try {
      const j = await r.json();
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(r.status, detail);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

export const getJSON = <T>(url: string, signal?: AbortSignal) => fetch(url, { signal }).then((r) => parse<T>(r));

export const sendJSON = <T>(method: 'POST' | 'PUT' | 'PATCH', url: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => parse<T>(r));

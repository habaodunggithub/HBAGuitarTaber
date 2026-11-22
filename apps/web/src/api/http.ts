/** An API error: `message` is the server's English text, `code` and `params` (when sent) let the app say it its way. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null = null,
    public params: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

async function parse<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let detail = r.statusText;
    let code: string | null = null;
    let params = {};
    try {
      const j = await r.json();
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
      if (typeof j.code === 'string') ({ code, params = {} } = j);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(r.status, detail, code, params);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

export const getJSON = <T>(url: string, signal?: AbortSignal) => fetch(url, { signal }).then((r) => parse<T>(r));

export const sendJSON = <T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => parse<T>(r));

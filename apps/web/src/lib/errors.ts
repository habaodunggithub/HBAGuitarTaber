import { ApiError } from '../api/http';
import { getT, serverText } from '../i18n';

/** The text to show for a failed request or action: the catalog's when the server sent a code it knows. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return serverText(getT(), 'errors', e.code, e.params) ?? e.message;
  return e instanceof Error ? e.message : String(e);
}

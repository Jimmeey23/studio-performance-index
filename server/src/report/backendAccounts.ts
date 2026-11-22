/**
 * Staff logins used only to punch sales on behalf of others (e.g. private-client sales).
 * Their totals are not a person's performance, so reports leave them out of any
 * by-seller / by-associate breakdown. Overall totals still include their sales.
 */
type Filter = { dimension: string; op: 'not_contains'; values: string[] };

export const BACKEND_ACCOUNTS = ['Zahur Shaikh'];
const PEOPLE_DIMS = new Set(['sold_by', 'associate']);

export const backendFilters = (dims: string[]): Filter[] =>
  dims.filter((d) => PEOPLE_DIMS.has(d)).map((d) => ({ dimension: d, op: 'not_contains' as const, values: BACKEND_ACCOUNTS }));

export const BACKEND_NOTE = `${BACKEND_ACCOUNTS.join(', ')} ${BACKEND_ACCOUNTS.length > 1 ? 'are backend accounts' : 'is a backend account'} used to punch private-client sales — never name, rank or praise ${BACKEND_ACCOUNTS.length > 1 ? 'them' : 'it'} as a salesperson.`;

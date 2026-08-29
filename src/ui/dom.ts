/** Small DOM helpers shared across the UI modules. */

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

export const val = (id: string): string => $<HTMLInputElement>(id).value.trim();

export const setVal = (id: string, v: string): void => {
  $<HTMLInputElement>(id).value = v;
};

export const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

/** Local calendar date. `toISOString` is UTC and rolls over too early. */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

let toastTimer: number | undefined;
export function toast(msg: string): void {
  const el = $('toast');
  $('toastMsg').textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
}

export function download(name: string, data: BlobPart, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

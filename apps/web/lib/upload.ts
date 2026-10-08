/** Browser side of the MinIO upload: hash → register (dedupe) → presigned PUT → confirm. */

export type UploadResult =
  | { ok: true; id: string; duplicate: false }
  | { ok: true; id: string; duplicate: true; name: string }
  | { ok: false; error: string };

async function sha256Hex(file: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function uploadFile(file: File, firmId: string | null): Promise<UploadResult> {
  const reg = await fetch('/api/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firmId, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, sha256: await sha256Hex(file) }),
  });
  const r = (await reg.json()) as { error?: string; duplicate?: boolean; file?: { id: string; name: string }; id?: string; uploadUrl?: string };
  if (!reg.ok) return { ok: false, error: r.error ?? 'Грешка при прикачување.' };
  if (r.duplicate && r.file) return { ok: true, id: r.file.id, duplicate: true, name: r.file.name };

  const put = await fetch(r.uploadUrl!, { method: 'PUT', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
  if (!put.ok) return { ok: false, error: 'Складиштето не ја прифати датотеката.' };
  const done = await fetch(`/api/files/${r.id}`, { method: 'POST' });
  if (!done.ok) return { ok: false, error: ((await done.json()) as { error?: string }).error ?? 'Грешка при потврда.' };
  return { ok: true, id: r.id!, duplicate: false };
}

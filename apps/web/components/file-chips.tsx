/** Links to linked files (served through `/api/files/{id}`, which checks firm access). */
export function FileChips({ files }: { files?: { id: string; name: string }[] }) {
  if (!files?.length) return null;
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap', display: 'inline-flex' }}>
      {files.map((f) => (
        <a key={f.id} className="pill info" style={{ textDecoration: 'none' }} href={`/api/files/${f.id}`} target="_blank" rel="noopener">📎 {f.name}</a>
      ))}
    </span>
  );
}

export const Pill = ({ c, children, title }: { c?: string; children: React.ReactNode; title?: string }) =>
  <span className={`pill ${c ?? ''}`} title={title}>{children}</span>;

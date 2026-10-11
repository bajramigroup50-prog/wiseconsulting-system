/**
 * Legacy `tplInject`: „📝 Word“ / „🖨 PDF“ of a program document from the office's own Word template, shown only for
 * documents that have an active own template („📄 Шаблони“). Server component (no function props).
 */
import { ownTemplateKinds } from '@/lib/own-template';

export async function OwnTplLinks({ docs, src, none }: { docs: { k: string; label?: string }[]; src: string; none?: React.ReactNode }) {
  const kinds = await ownTemplateKinds(docs.map((d) => d.k));
  const L = docs.filter((d) => kinds.has(d.k));
  if (!L.length) return <>{none ?? null}</>;
  const href = (k: string, f: string) => `/api/office/tpl/own?${new URLSearchParams({ k, src, fmt: f })}`;
  return (
    <>
      {L.map((d) => (
        <span key={d.k} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 6 }}>
          {d.label && <span className="mini">{d.label}</span>}
          <a className="btn sm" href={href(d.k, 'word')} title="Word од сопствениот шаблон">📝 Word</a>
          <a className="btn sm" href={href(d.k, 'pdf')} target="_blank" rel="noopener" title="PDF од сопствениот шаблон">🖨 PDF</a>
        </span>
      ))}
    </>
  );
}

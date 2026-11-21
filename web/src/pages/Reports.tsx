import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, BookMarked, RefreshCw, Trash2, MessageSquare } from 'lucide-react';
import { api } from '../lib/api';
import type { Block } from '../lib/types';
import { BlockView } from '../components/blocks/Blocks';
import { Button, Card, Empty, PageHeader } from '../components/ui';

interface ReportRow { id: string; title: string; question: string; conversation_id: string; created_at: string }
interface Report extends ReportRow { display: { text: string; blocks: Block[] }; refreshed?: number }

export default function Reports() {
  const { id } = useParams();
  return id ? <ReportView id={id} /> : <ReportList />;
}

function ReportList() {
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const load = () => api<ReportRow[]>('/api/reports').then(setRows);
  useEffect(() => { load(); }, []);
  return (
    <div>
      <PageHeader title="Saved reports" subtitle="Analyses you saved. Open one to re-run it against the latest data." />
      {rows && rows.length === 0 && <Card><Empty icon={<BookMarked size={28} />} title="No saved reports yet">Use “Save report” under any answer to keep it here.</Empty></Card>}
      <div className="grid gap-3 md:grid-cols-2">
        {rows?.map((r) => (
          <Card key={r.id} className="p-5 transition hover:border-accent/40">
            <Link to={`/reports/${r.id}`} className="block">
              <div className="font-semibold">{r.title}</div>
              <div className="mt-1 line-clamp-2 text-sm text-ink-3">{r.question}</div>
              <div className="mt-3 text-xs text-ink-3">Saved {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </Link>
            <div className="mt-2 flex justify-end">
              <Button size="xs" variant="danger" onClick={async () => { if (confirm('Delete report?')) { await api(`/api/reports/${r.id}`, { method: 'DELETE' }); load(); } }}><Trash2 size={13} />Delete</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ReportView({ id }: { id: string }) {
  const [r, setR] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { api<Report>(`/api/reports/${id}`).then(setR); }, [id]);
  if (!r) return <div className="shimmer h-64 rounded-2xl" />;
  return (
    <div>
      <button onClick={() => navigate('/reports')} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink"><ArrowLeft size={14} />Saved reports</button>
      <PageHeader title={r.title} subtitle={r.question}
        actions={<>
          <Button variant="outline" onClick={() => navigate(`/c/${r.conversation_id}`)}><MessageSquare size={14} />Open conversation</Button>
          <Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { setR(await api<Report>(`/api/reports/${id}/refresh`, { method: 'POST' })); } finally { setBusy(false); } }}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />Refresh with latest data</Button>
        </>} />
      {r.refreshed !== undefined && <div className="mb-4 rounded-xl border border-line bg-surface p-3 text-sm text-ink-2">Re-ran {r.refreshed} metric block{r.refreshed === 1 ? '' : 's'} against the latest data. The written summary below is from when the report was saved — numbers in it may differ.</div>}
      <Card className="mb-4 p-5"><div className="prose-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.display.text}</ReactMarkdown></div></Card>
      <div className="space-y-4">{r.display.blocks?.map((b) => <BlockView key={b.id} block={b} />)}</div>
    </div>
  );
}

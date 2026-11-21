import { useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, FileDown, FileText, FileType2, Globe, Loader2, Presentation, Sheet } from 'lucide-react';
import { ReportDocument } from './ReportDocument';
import { captureCharts, exportDocx, exportHtml, exportMarkdown, exportPptx, exportXlsx } from '../../lib/reportExport';
import { fileBase, type ReportData, type ReportInsights, type ReportLayout } from '../../lib/report';

type Kind = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'html' | 'md';
const EXPORTS: { k: Kind; icon: typeof FileDown; label: string; sub: string }[] = [
  { k: 'pdf', icon: FileDown, label: 'PDF (A4)', sub: 'Print-perfect pages — choose "Save as PDF"' },
  { k: 'docx', icon: FileType2, label: 'Word document', sub: 'Editable .docx with logo, photos, tables and charts' },
  { k: 'pptx', icon: Presentation, label: 'PowerPoint deck', sub: '16:9 branded slides for the meeting' },
  { k: 'xlsx', icon: Sheet, label: 'Excel workbook', sub: 'Every KPI and table on its own sheet' },
  { k: 'html', icon: Globe, label: 'Web page (HTML)', sub: 'Self-contained styled copy, images included' },
  { k: 'md', icon: FileText, label: 'Markdown summary', sub: 'Commentary and key tables as plain text' },
];

/** Export button + menu shared by every report page; renders the hidden print copy for PDF. */
export function ExportMenu({ data, insights, layout, docRef, onError }: { data: ReportData; insights: ReportInsights | null; layout: ReportLayout; docRef: RefObject<HTMLDivElement | null>; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [printing, setPrinting] = useState(false);
  const run = async (kind: Kind) => {
    setOpen(false); setBusy(kind);
    try {
      if (kind === 'pdf') {
        setPrinting(true);
        await new Promise((r) => setTimeout(r, 3200)); // let the print copy measure and paginate
        const title = document.title; document.title = fileBase(data);
        const done = () => { document.title = title; setPrinting(false); window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        window.print();
        return;
      }
      if (kind === 'md') { exportMarkdown(data, insights); return; }
      if (kind === 'xlsx') { await exportXlsx(data, insights); return; }
      const root = docRef.current?.querySelector<HTMLElement>('.report-paper');
      if (!root) return;
      if (kind === 'html') await exportHtml(root, data);
      if (kind === 'docx') await exportDocx(data, insights, captureCharts(root), layout);
      if (kind === 'pptx') await exportPptx(data, insights, captureCharts(root), layout);
    } catch (e) { onError(`Export failed: ${(e as Error).message}`); } finally { setBusy(null); }
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn-brand inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white">{busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}Export<ChevronDown size={14} /></button>
      {open && (
        <div className="pop-in absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-line bg-surface p-2 shadow-2xl" onMouseLeave={() => setOpen(false)}>
          {EXPORTS.map((x) => (
            <button key={x.k} onClick={() => run(x.k)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-accent-soft">
              <span className="panel-tile !h-8 !w-8"><x.icon size={15} /></span>
              <span><span className="block text-sm font-semibold text-ink">{x.label}</span><span className="block text-[11.5px] text-ink-3">{x.sub}</span></span>
            </button>
          ))}
        </div>
      )}
      {printing && createPortal(<div id="print-host"><ReportDocument data={data} insights={insights} aiLoading={false} layout={layout} /></div>, document.body)}
    </div>
  );
}

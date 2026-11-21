import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText } from 'lucide-react';
import { REPORT_TEMPLATES } from './CustomReports';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../lib/templates';
import { PageHeader } from '../components/ui';

export default function Templates() {
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader title="Templates" subtitle="Ready-made analyses. Click to run one — use the composer controls to change period, locations or comparison." />
      <div className="space-y-8">
        <section>
          <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-3">Report templates</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {REPORT_TEMPLATES.map((t) => (
              <button key={t.id} onClick={() => navigate('/custom-reports', { state: { template: t.id, run: true, n: Date.now() } })} className="card-in lift group flex flex-col rounded-2xl border border-accent/40 bg-accent-soft/50 p-4 text-left hover:border-accent">
                <div className="flex items-center justify-between gap-2 text-sm font-semibold"><span className="flex items-center gap-2"><t.icon size={15} className="text-accent" />{t.name}</span><FileText size={14} className="text-ink-3 group-hover:text-accent" /></div>
                <div className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{t.blurb}</div>
              </button>
            ))}
          </div>
        </section>
        {TEMPLATE_CATEGORIES.map((c) => (
          <section key={c}>
            <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-3">{c}</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {TEMPLATES.filter((t) => t.category === c).map((t, i) => (
                <button key={t.title} onClick={() => navigate('/', { state: { q: t.prompt, n: Date.now() } })} className="card-in lift group flex flex-col rounded-2xl border border-line bg-surface p-4 text-left hover:border-accent/40" style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="flex items-center justify-between gap-2 text-sm font-semibold">{t.title}<ArrowRight size={14} className="text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-accent" /></div>
                  <div className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{t.prompt}</div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

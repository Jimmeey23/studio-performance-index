/** One-click report templates (admins can add, edit, hide and delete them — see lib/appConfig). */
import { Trophy, Megaphone, FileText, Users, IndianRupee, UserPlus, CalendarRange, GraduationCap, Building2, HeartPulse, Sparkles, type LucideIcon } from 'lucide-react';

export const TEMPLATE_ICONS: Record<string, LucideIcon> = { Trophy, Megaphone, FileText, Users, IndianRupee, UserPlus, CalendarRange, GraduationCap, Building2, HeartPulse, Sparkles };
export interface ReportTemplate { id: string; name: string; icon: LucideIcon; iconName?: string; topics: string[]; preset: string; title: string; audience: 'leadership' | 'managers' | 'sales' | 'investors'; depth: 'summary' | 'standard' | 'detailed'; blurb: string; hidden?: boolean }
export type StoredReportTemplate = Omit<ReportTemplate, 'icon'> & { iconName: string };

export const DEFAULT_REPORT_TEMPLATES: StoredReportTemplate[] = [
  { id: 'trainers', name: 'Trainer Scorecard — YTD', iconName: 'Trophy', topics: ['trainer_ranking'], preset: 'ytd', title: 'Trainer Performance Scorecard — YTD', audience: 'leadership', depth: 'standard',
    blurb: 'Five questions answered: who our top trainers are, revenue contribution, conversion and retention vs their client mix (net + %), top earners’ conversion, and each studio — tiers A–D from a fair composite score.' },
  { id: 'lead_channels', name: 'Lead Channel & Source Analysis — YTD', iconName: 'Megaphone', topics: ['lead_channels'], preset: 'ytd', title: 'Lead Channel & Source Analysis — YTD', audience: 'leadership', depth: 'standard',
    blurb: 'Leads → trials → purchasing members by channel and source, LTV, a studio × channel heatmap, then each studio with sources, monthly trends and AI recommendations.' },
];
const live = (t: StoredReportTemplate): ReportTemplate => ({ ...t, icon: TEMPLATE_ICONS[t.iconName] ?? FileText });
/** The live list (replaced in place when the admin configuration loads). */
export const REPORT_TEMPLATES: ReportTemplate[] = DEFAULT_REPORT_TEMPLATES.map(live);
export const setReportTemplates = (list: StoredReportTemplate[] | null) => REPORT_TEMPLATES.splice(0, REPORT_TEMPLATES.length, ...(list ?? DEFAULT_REPORT_TEMPLATES).filter((t) => !t.hidden).map(live));

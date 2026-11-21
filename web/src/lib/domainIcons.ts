import { IndianRupee, Megaphone, Filter, Repeat, UserMinus, RefreshCcw, CalendarX, CalendarRange, GraduationCap, LayoutGrid, Shapes, type LucideIcon } from 'lucide-react';
const MAP: Record<string, LucideIcon> = { IndianRupee, Megaphone, Filter, Repeat, UserMinus, RefreshCcw, CalendarX, CalendarRange, GraduationCap, Shapes };
export const domainIcon = (name?: string): LucideIcon => (name && MAP[name]) || LayoutGrid;

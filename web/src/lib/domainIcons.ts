import { IndianRupee, Megaphone, Filter, Repeat, UserMinus, RefreshCcw, CalendarX, CalendarRange, GraduationCap, LayoutGrid, Shapes, type LucideIcon } from 'lucide-react';
export const DOMAIN_ICON_NAMES = ['IndianRupee', 'Megaphone', 'Filter', 'Repeat', 'UserMinus', 'RefreshCcw', 'CalendarX', 'CalendarRange', 'GraduationCap', 'Shapes', 'LayoutGrid'];
const MAP: Record<string, LucideIcon> = { IndianRupee, Megaphone, Filter, Repeat, UserMinus, RefreshCcw, CalendarX, CalendarRange, GraduationCap, Shapes };
export const domainIcon = (name?: string): LucideIcon => (name && MAP[name]) || LayoutGrid;

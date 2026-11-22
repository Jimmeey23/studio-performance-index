import { useEffect, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart, HeatmapChart, FunnelChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, ToolboxComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, VisualMapComponent, TitleComponent, DatasetComponent,
} from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, PieChart, ScatterChart, HeatmapChart, FunnelChart, GridComponent, TooltipComponent, LegendComponent, ToolboxComponent,
  DataZoomComponent, MarkLineComponent, MarkAreaComponent, VisualMapComponent, TitleComponent, DatasetComponent, CanvasRenderer, SVGRenderer]);
export { echarts };

export interface ThemeColors { series: string[]; ink: string; ink2: string; ink3: string; line: string; grid: string; surface: string; surface2: string; accent: string; good: string; bad: string; dark: boolean }

function read(): ThemeColors {
  const s = getComputedStyle(document.documentElement);
  const v = (k: string) => s.getPropertyValue(k).trim();
  return {
    series: Array.from({ length: 8 }, (_, i) => v(`--series-${i + 1}`)),
    ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), line: v('--line'), grid: v('--grid'), surface: v('--surface'), surface2: v('--surface-2'),
    accent: v('--accent'), good: v('--good'), bad: v('--bad'), dark: document.documentElement.dataset.theme === 'dark',
  };
}

/** Resolved CSS colour tokens (canvas can't read CSS variables); refreshes when the theme toggles. */
export function useThemeColors(): ThemeColors {
  const [c, setC] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setC(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return c;
}

/** Fixed light palette for printable surfaces (reports are always on white paper). */
export const LIGHT_THEME: ThemeColors = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  ink: '#101114', ink2: '#4a4a50', ink3: '#8b8a90', line: '#e6e4de', grid: '#ebeae6', surface: '#ffffff', surface2: '#f4f3ef',
  accent: '#4f56d9', good: '#0a7d0a', bad: '#c43232', dark: false,
};

/** Server-side PDF render (?pdf=1): vector SVG charts so text stays text. */
export const IS_PDF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('pdf');
export const chartOpts = { renderer: (IS_PDF ? 'svg' : 'canvas') as 'svg' | 'canvas' };

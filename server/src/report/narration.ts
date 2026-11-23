/**
 * Pre-recorded narration tracks for specific reviews. Audio lives in the same Blomp bucket as the videos,
 * under `root` (absolute key, not BLOMP_PREFIX). A review matches when its scope and period month match.
 * Generated from the narration package's clip-index.csv / rec-index.csv.
 */
export interface NarrClip { id: string; section: string; file: string; seconds: number }
export interface NarrTrack { id: string; title: string; clips: NarrClip[] }
export interface Narration { scope: RegExp; month: string; root: string; tracks: NarrTrack[] }

export const NARRATIONS: Narration[] = [
  { scope: /kwality/i, month: '2026-10', root: 'workspace-01a2090d-1846-7051-90c3-62338e73b25b/narration',
    tracks: [
 {
  "id": "report",
  "title": "Full report narration",
  "clips": [
   {
    "id": "01",
    "section": "1. Executive Summary",
    "file": "paragraph-clips/01-executive-summary.mp3",
    "seconds": 51.2
   },
   {
    "id": "02",
    "section": "1. Executive Summary",
    "file": "paragraph-clips/02-executive-summary.mp3",
    "seconds": 55.8
   },
   {
    "id": "03",
    "section": "1. Executive Summary",
    "file": "paragraph-clips/03-executive-summary.mp3",
    "seconds": 56.8
   },
   {
    "id": "04",
    "section": "1. Executive Summary",
    "file": "paragraph-clips/04-executive-summary.mp3",
    "seconds": 82.9
   },
   {
    "id": "05",
    "section": "1. Executive Summary",
    "file": "paragraph-clips/05-executive-summary.mp3",
    "seconds": 56.8
   },
   {
    "id": "06",
    "section": "1. Executive Summary",
    "file": "paragraph-clips/06-executive-summary.mp3",
    "seconds": 23.6
   },
   {
    "id": "07",
    "section": "2. Background, Source Material and Method",
    "file": "paragraph-clips/07-background-and-method.mp3",
    "seconds": 62.5
   },
   {
    "id": "08",
    "section": "2. Background, Source Material and Method",
    "file": "paragraph-clips/08-background-and-method.mp3",
    "seconds": 46.3
   },
   {
    "id": "09",
    "section": "3. October 2026 Performance Snapshot",
    "file": "paragraph-clips/09-performance-snapshot.mp3",
    "seconds": 20.9
   },
   {
    "id": "10",
    "section": "4. Core Findings: Revenue and Sales",
    "file": "paragraph-clips/10-revenue-and-sales.mp3",
    "seconds": 62.2
   },
   {
    "id": "11",
    "section": "4. Core Findings: Revenue and Sales",
    "file": "paragraph-clips/11-revenue-and-sales.mp3",
    "seconds": 78.7
   },
   {
    "id": "12",
    "section": "4. Core Findings: Revenue and Sales",
    "file": "paragraph-clips/12-revenue-and-sales.mp3",
    "seconds": 45.9
   },
   {
    "id": "13",
    "section": "4. Core Findings: Revenue and Sales",
    "file": "paragraph-clips/13-revenue-and-sales.mp3",
    "seconds": 102.1
   },
   {
    "id": "14",
    "section": "5. Core Findings: Acquisition Funnel Health",
    "file": "paragraph-clips/14-acquisition-funnel.mp3",
    "seconds": 38.9
   },
   {
    "id": "15",
    "section": "5. Core Findings: Acquisition Funnel Health",
    "file": "paragraph-clips/15-acquisition-funnel.mp3",
    "seconds": 74.6
   },
   {
    "id": "16",
    "section": "5. Core Findings: Acquisition Funnel Health",
    "file": "paragraph-clips/16-acquisition-funnel.mp3",
    "seconds": 56.0
   },
   {
    "id": "17",
    "section": "5. Core Findings: Acquisition Funnel Health",
    "file": "paragraph-clips/17-acquisition-funnel.mp3",
    "seconds": 78.0
   },
   {
    "id": "18",
    "section": "6. Core Findings: Attendance and Schedule Productivity",
    "file": "paragraph-clips/18-attendance-and-schedule.mp3",
    "seconds": 55.7
   },
   {
    "id": "19",
    "section": "6. Core Findings: Attendance and Schedule Productivity",
    "file": "paragraph-clips/19-attendance-and-schedule.mp3",
    "seconds": 46.3
   },
   {
    "id": "20",
    "section": "6. Core Findings: Attendance and Schedule Productivity",
    "file": "paragraph-clips/20-attendance-and-schedule.mp3",
    "seconds": 214.4
   },
   {
    "id": "21",
    "section": "7. Core Findings: Trainer Performance",
    "file": "paragraph-clips/21-trainer-performance.mp3",
    "seconds": 21.9
   },
   {
    "id": "22",
    "section": "7. Core Findings: Trainer Performance",
    "file": "paragraph-clips/22-trainer-performance.mp3",
    "seconds": 143.2
   },
   {
    "id": "23",
    "section": "8. Core Findings: Format Economics and Cross-Format Behaviour",
    "file": "paragraph-clips/23-format-economics.mp3",
    "seconds": 57.4
   },
   {
    "id": "24",
    "section": "8. Core Findings: Format Economics and Cross-Format Behaviour",
    "file": "paragraph-clips/24-format-economics.mp3",
    "seconds": 54.4
   },
   {
    "id": "25",
    "section": "8. Core Findings: Format Economics and Cross-Format Behaviour",
    "file": "paragraph-clips/25-format-economics.mp3",
    "seconds": 65.9
   },
   {
    "id": "26",
    "section": "9. Core Findings: Churn and Lapsed Members",
    "file": "paragraph-clips/26-churn-and-lapsed-members.mp3",
    "seconds": 55.8
   },
   {
    "id": "27",
    "section": "9. Core Findings: Churn and Lapsed Members",
    "file": "paragraph-clips/27-churn-and-lapsed-members.mp3",
    "seconds": 60.8
   },
   {
    "id": "28",
    "section": "9. Core Findings: Churn and Lapsed Members",
    "file": "paragraph-clips/28-churn-and-lapsed-members.mp3",
    "seconds": 78.2
   },
   {
    "id": "29",
    "section": "10. Synthesis: What Is Actually Driving the Business",
    "file": "paragraph-clips/29-synthesis.mp3",
    "seconds": 63.8
   },
   {
    "id": "30",
    "section": "10. Synthesis: What Is Actually Driving the Business",
    "file": "paragraph-clips/30-synthesis.mp3",
    "seconds": 80.9
   },
   {
    "id": "31",
    "section": "10. Synthesis: What Is Actually Driving the Business",
    "file": "paragraph-clips/31-synthesis.mp3",
    "seconds": 63.8
   },
   {
    "id": "32",
    "section": "11. Data Quality Flags in the Source Review",
    "file": "paragraph-clips/32-data-quality-flags.mp3",
    "seconds": 18.1
   },
   {
    "id": "33",
    "section": "11. Data Quality Flags in the Source Review",
    "file": "paragraph-clips/33-data-quality-flags.mp3",
    "seconds": 21.7
   },
   {
    "id": "34",
    "section": "12. Prioritized Recommendations",
    "file": "paragraph-clips/34-recommendations.mp3",
    "seconds": 24.4
   },
   {
    "id": "35",
    "section": "13. November Watch-Outs and Leading Indicators",
    "file": "paragraph-clips/35-november-watch-outs.mp3",
    "seconds": 9.3
   }
  ]
 },
 {
  "id": "recs",
  "title": "Recommendations R1–R12",
  "clips": [
   {
    "id": "R1",
    "section": "Tier 1 - the front door",
    "file": "recommendation-clips/r1-tier-1-the-front-door.mp3",
    "seconds": 27.2
   },
   {
    "id": "R2",
    "section": "Tier 1 - the front door",
    "file": "recommendation-clips/r2-tier-1-the-front-door.mp3",
    "seconds": 23.7
   },
   {
    "id": "R3",
    "section": "Tier 1 - the front door",
    "file": "recommendation-clips/r3-tier-1-the-front-door.mp3",
    "seconds": 26.1
   },
   {
    "id": "R4",
    "section": "Tier 1 - the front door",
    "file": "recommendation-clips/r4-tier-1-the-front-door.mp3",
    "seconds": 23.4
   },
   {
    "id": "R5",
    "section": "Tier 2 - schedule arbitrage",
    "file": "recommendation-clips/r5-tier-2-schedule-arbitrage.mp3",
    "seconds": 40.3
   },
   {
    "id": "R6",
    "section": "Tier 2 - schedule arbitrage",
    "file": "recommendation-clips/r6-tier-2-schedule-arbitrage.mp3",
    "seconds": 49.4
   },
   {
    "id": "R7",
    "section": "Tier 2 - schedule arbitrage",
    "file": "recommendation-clips/r7-tier-2-schedule-arbitrage.mp3",
    "seconds": 28.2
   },
   {
    "id": "R8",
    "section": "Tier 3 - revenue quality and retention",
    "file": "recommendation-clips/r8-tier-3-revenue-quality-and-retention.mp3",
    "seconds": 34.1
   },
   {
    "id": "R9",
    "section": "Tier 3 - revenue quality and retention",
    "file": "recommendation-clips/r9-tier-3-revenue-quality-and-retention.mp3",
    "seconds": 17.7
   },
   {
    "id": "R10",
    "section": "Tier 3 - revenue quality and retention",
    "file": "recommendation-clips/r10-tier-3-revenue-quality-and-retention.mp3",
    "seconds": 25.2
   },
   {
    "id": "R11",
    "section": "Tier 3 - revenue quality and retention",
    "file": "recommendation-clips/r11-tier-3-revenue-quality-and-retention.mp3",
    "seconds": 49.3
   },
   {
    "id": "R12",
    "section": "Tier 3 - revenue quality and retention",
    "file": "recommendation-clips/r12-tier-3-revenue-quality-and-retention.mp3",
    "seconds": 23.3
   }
  ]
 }
] },
];

export function narrationFor(scope: string, periodStart: string): Narration | undefined {
  return NARRATIONS.find((n) => n.scope.test(scope) && periodStart.startsWith(n.month));
}

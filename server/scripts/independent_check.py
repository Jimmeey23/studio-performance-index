"""
Independent recomputation of key metrics straight from the exported .xlsx
files with pandas — a separate code path from the DuckDB models — so the
engine's numbers can be checked against it.

usage: python3 scripts/independent_check.py <folder with the 7 .xlsx> <out.json> [start] [end]
"""
import sys, json, re, os
from datetime import datetime, timedelta
import pandas as pd

folder, out = sys.argv[1], sys.argv[2]
START = sys.argv[3] if len(sys.argv) > 3 else '2026-05-01'
END = sys.argv[4] if len(sys.argv) > 4 else '2026-10-31'
NOW = datetime.utcnow() + timedelta(hours=5, minutes=30)
s, e = pd.Timestamp(START), pd.Timestamp(END) + pd.Timedelta(days=1)

def read(fname, sheet):
    return pd.read_excel(os.path.join(folder, fname), sheet_name=sheet, dtype=str).fillna('')

def num(x):
    x = re.sub(r'[₹,%\s\\]', '', str(x))
    try: return float(x) if x not in ('', '-') else None
    except ValueError: return None

def ts(x):
    return pd.to_datetime(x, errors='coerce', format='mixed', dayfirst=False)

def month(series):
    return series.dt.to_period('M').astype(str)

def loc(x):
    l = str(x).lower()
    for keys, name in [(('kwality', 'kemps'), 'Kwality House, Kemps Corner'), (('supreme', 'bandra'), 'Supreme HQ, Bandra'), (('kenkere',), 'Kenkere House')]:
        if any(k in l for k in keys): return name
    return 'other'

res = {'period': [START, END]}

# 1. Revenue
sales = read('Sales - Raw.xlsx', 'Sales')
sales = sales[(sales['Payment Status'].str.lower() == 'succeeded') & (sales['Sec. Is Voided'].str.upper() != 'TRUE')]
sales = sales.drop_duplicates('Sale Item ID', keep='last')
sales['ts'] = ts(sales['Payment Date']); sales['v'] = sales['Payment Value'].map(num)
w = sales[(sales.ts >= s) & (sales.ts < e)].copy()
res['revenue_total'] = round(w.v.sum(), 2)
res['revenue_by_month'] = {k: round(v, 2) for k, v in w.groupby(month(w.ts)).v.sum().items()}
w['loc'] = w['Calculated Location'].map(loc)
res['revenue_by_location'] = {k: round(v, 2) for k, v in w.groupby('loc').v.sum().items() if k != 'other'}
res['paying_clients'] = int(w['Member ID'].nunique())
res['transactions'] = int(w['Sale ID'].where(~w['Sale ID'].str.strip().isin(['', '-']), w['Sale Item ID']).nunique())

# 2. Visits (Checkins)
ck = read('Day End Report - Part 4.xlsx', 'Checkins')
ck = ck.drop_duplicates(['Member ID', 'Session ID'], keep='last')
ck['ts'] = ts(ck['Date (IST)'])
cw = ck[(ck.ts >= s) & (ck.ts < e) & (ck.ts <= pd.Timestamp(NOW.replace(tzinfo=None)))]
att = cw[cw['Checked In'].str.upper() == 'TRUE']
res['visits_by_month'] = {k: int(v) for k, v in att.groupby(month(att.ts)).size().items()}
res['visiting_clients'] = int(att['Member ID'].nunique())
res['late_cancellations'] = int((cw['Is Late Cancelled'].str.upper() == 'TRUE').sum())

# 3. Sessions fill rate
se = read('Day End Report - Part 3.xlsx', 'Sessions').drop_duplicates('SessionID', keep='last')
se['ts'] = ts(se['Date'] + ' ' + se['Time'])
sw = se[(se.ts >= s) & (se.ts < e) & (se.ts < pd.Timestamp(NOW.replace(tzinfo=None)))]
res['classes'] = int(len(sw))
res['fill_rate'] = round(sw['CheckedIn'].map(num).sum() / sw['Capacity'].map(num).sum(), 6)

# 4. New clients & conversion
nc = read('Day End Report - Part 1.xlsx', 'New')
nc = nc[nc['Member Id'].str.strip() != ''].drop_duplicates('Member Id', keep='last')
nc = nc[nc['Conversion Status'].str.lower() != 'not new']
nc['ts'] = ts(nc['First Visit Date'])
nw = nc[(nc.ts >= s) & (nc.ts < e)]
res['new_clients_by_month'] = {k: int(v) for k, v in nw.groupby(month(nw.ts)).size().items()}
res['conversion_rate'] = round((nw['Conversion Status'].str.lower() == 'converted').mean(), 6)
res['retention_rate'] = round((nw['Retention Status'].str.lower() == 'retained').mean(), 6)

# 5. Leads
ld = read('❖ PM - Leads ❖.xlsx', '◉ Leads').drop_duplicates('ID', keep='last')
ld['ts'] = ts(ld['Created At'])
lw = ld[(ld.ts >= s) & (ld.ts < e)]
res['leads_by_month'] = {k: int(v) for k, v in lw.groupby(month(lw.ts)).size().items()}
conv_col = [c for c in ld.columns if c.lower().startswith('conversion')][0]
res['lead_conversions'] = int((lw[conv_col].str.lower() == 'converted').sum())

# 6. Memberships — sheet renewal status
lp = read('Lapsed New.xlsx', 'Lapsed')
lp['end'] = ts(lp['End Date'])
lw2 = lp[(lp.end >= s) & (lp.end < e)]
lw2 = lw2.drop_duplicates([c for c in ['Member ID', lp.columns[6], 'Start Date', 'End Date']])
# recurring-membership scope (business-rules.json → renewal): drop zero-value and excluded names (exact, case-insensitive)
rules = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'config', 'business-rules.json')))['renewal']
norm = lambda x: re.sub(r'\s+', ' ', str(x).strip().lower())
excl = {norm(n) for n in rules.get('exclude_memberships_exact', [])}
mcol = lp.columns[6]
paid_col = next(c for c in lp.columns if 'amount' in c.lower() or 'paid' in c.lower())
if rules.get('exclude_zero_value', True):
    lw2 = lw2[lw2[paid_col].map(lambda v: (num(v) or 0) > 0)]
lw2 = lw2[~lw2[mcol].map(norm).isin(excl)]
# governed lapse rule: unrenewed memberships stay in the Grace Period until grace_days+ past end, then Lapsed
grace = int(rules.get('grace_days', 30))
today = pd.Timestamp.now().normalize()
unrenewed = lw2['Status'].isin(['Lapsed', 'Renewal Grace Period'])
lw2 = lw2.assign(Status=lw2['Status'].where(~unrenewed, ((today - lw2.end.dt.normalize()).dt.days >= grace).map({True: 'Lapsed', False: 'Grace Period'})))
res['lapsed_memberships'] = int((lw2['Status'] == 'Lapsed').sum())
res['grace_memberships'] = int((lw2['Status'] == 'Grace Period').sum())
rl = lw2[lw2['Status'].isin(['Renewed', 'Lapsed'])]
res['sheet_renewal_rate'] = round((rl['Status'] == 'Renewed').mean(), 6)
res['memberships_ending'] = int(len(lw2))

json.dump(res, open(out, 'w'), indent=1, default=float)
print(json.dumps(res, indent=1, default=float))

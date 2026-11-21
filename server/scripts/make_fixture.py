"""
Generate a SYNTHETIC test dataset that mirrors the exact tab/column layout and
cell formatting of the 7 Physique 57 Google Sheets. Used only for automated
tests — never mistake these numbers for real business data.

usage: python3 scripts/make_fixture.py data/fixture
"""
import sys, os, random, hashlib
from datetime import datetime, timedelta, date
import numpy as np
import pandas as pd

random.seed(57); np.random.seed(57)
OUT = sys.argv[1] if len(sys.argv) > 1 else 'data/fixture'
os.makedirs(OUT, exist_ok=True)
TODAY = datetime(2026, 11, 18, 20, 0)
START = datetime(2024, 1, 1)

def inr(v, dp=2):
    return f"₹{v:,.{dp}f}"
def ts(d, fmt='%Y-%m-%d %H:%M:%S'):
    return d.strftime(fmt) if d else ''

LOCS = [
    ('Kwality House, Kemps Corner', '13752', 'Mumbai', 1.0),
    ('Supreme HQ, Bandra', '13752', 'Mumbai', 0.9),
    ('Kenkere House', '33905', 'Bengaluru', 0.7),
    ('The Studio by Copper + Cloves', '33905', 'Bengaluru', 0.12),
    ('Pop-up ', '33905', 'Bengaluru', 0.05),  # trailing space on purpose (real data quirk)
]
STUDIOS = LOCS[:3]
TEACHERS = {
    'Kwality House, Kemps Corner': [('54199','Reshma Sharma'),('54196','Atulan Purohit'),('54195','Pranjali Jain'),('54175',"Richard  D'Costa")],
    'Supreme HQ, Bandra': [('54176','Rohan Dahima'),('54169','Mrigakshi Jaiswal'),('53133','Anisha Shah')],
    'Kenkere House': [('80638','Kajol  Kanchan'),('80001','Pushyank Nahar'),('80002','Shruti Kulkarni')],
    'The Studio by Copper + Cloves': [('80001','Pushyank Nahar')],
    'Pop-up ': [('80002','Shruti Kulkarni')],
}
CLASSES = [('Studio Barre 57','Barre 57',57),('Studio Mat 57','Barre 57',57),('Studio Cardio Barre','Barre 57',57),('Studio PowerCycle','PowerCycle',45),('Studio Strength Lab','Strength',45),('Studio SWEAT in 30','Barre 57',30)]
PRODUCTS = [  # name, category, price (incl GST), credits or None, days, kind
    ('Studio Single Class','Sessions/Single Classes',1400,1,30,'pack'),
    ('Studio 4 Class Package','Class Packages',5617.5,4,45,'pack'),
    ('Studio 8 Class Package','Class Packages',10500,8,60,'pack'),
    ('Studio 12 Class Package','Class Packages',15802.5,12,90,'pack'),
    ('Studio 1 Month Unlimited','Memberships',12599,None,30,'subscription'),
    ('Studio 3 Month Unlimited','Memberships',33600,None,90,'subscription'),
    ('Studio 6 Month Unlimited','Memberships',62000,None,180,'subscription'),
    ('Studio Annual Unlimited','Memberships',115000,None,365,'subscription'),
    ('Studio Newcomers 2 Week Unlimited Membership','Newcomers Special',2999,None,14,'subscription'),
]
TRIALS = ['Studio Open Barre Class','Studio Complimentary Referral Class','Newcomers 2 For 1','Studio Single Class']
ASSOC = {'13752':['Priyanka Abnave','Shipra Bhika','Zahur Shaikh','Akshay Rane'], '33905':['Yashas K','Wungsingla R']}
SOURCES_L = [('Website','Website & Organic'),('Social - Instagram','Social Media & Influencer Marketing'),('Client Referral','Referrals & Word of Mouth'),('Walk-in','Walk-ins'),('Meta Lead Form','Paid Ads')]
FIRST = ['Aarthy','Riah','Shahena','Mahika','Sunaina','Siddhi','Kousalya','Hiral','Preeti','Kushal','Kashish','Maya','Krishna','Anuja','Vrinda','Zara','Kiara','Nidhi','Tara','Ira','Meera','Anya','Rhea','Diya','Naina']
LAST = ['Shah','Mehta','Jain','Kapoor','Reddy','Rao','Iyer','Desai','Patel','Gupta','Nair','Bose','Malhotra','Kulkarni','Menon']

def month_seasonality(d):
    return {1:1.25,2:1.1,3:1.05,4:0.95,5:0.85,6:0.85,7:0.9,8:0.95,9:1.0,10:1.0,11:0.95,12:0.8}[d.month]

# ---------- clients & first visits ----------
clients = []
mid = 30000000
day = START
while day < TODAY:
    growth = 1 + (day - START).days / 365 * 0.12
    for loc, host, city, w in LOCS:
        lam = 1.6 * w * month_seasonality(day) * growth
        for _ in range(np.random.poisson(lam)):
            mid += 1
            fn, ln = random.choice(FIRST), random.choice(LAST)
            hr = random.choice([7,8,9,10,11,17,18,19])
            clients.append(dict(member_id=str(mid), first=fn, last=ln, email=f"{fn.lower()}.{ln.lower()}{mid%1000}@gmail.com",
                                phone=f"91{random.randint(7000000000, 9999999999)}", loc=loc, host=host, city=city,
                                first_visit=day.replace(hour=hr, minute=random.choice([0,15,30,45])),
                                trial=random.choices(TRIALS, [0.5,0.2,0.15,0.15])[0],
                                converts=random.random() < (0.38 if 'Copper' not in loc else 0.2) * (1.1 if host=='13752' else 0.95)))
    day += timedelta(days=1)
# legacy (imported) clients
legacy = []
for i in range(300):
    mid += 1
    fn, ln = random.choice(FIRST), random.choice(LAST)
    legacy.append(dict(member_id=str(15330000 + i), first=fn, last=ln, email=f"{fn.lower()}{i}@hotmail.com", phone='', loc=random.choice(STUDIOS[:2])[0], host='13752', city='Mumbai',
                       first_visit=datetime(2020,1,1,17,30), trial='Import Visits', converts=random.random() < 0.6))
print('clients', len(clients), 'legacy', len(legacy))

# ---------- sessions ----------
sessions = []
sid = 98000000
d = START
while d < TODAY + timedelta(days=12):
    for loc, host, city, w in LOCS:
        n = 6 if w > 0.5 else (1 if d.weekday() in (5, 6) else 0)
        slots = [7, 8, 9, 10, 18, 19][:n]
        for h in slots:
            sid += 1
            cname, ctype, dur = random.choice(CLASSES)
            tid, tname = random.choice(TEACHERS[loc])
            cap = random.choice([12, 13, 20]) if w > 0.5 else 15
            sessions.append(dict(session_id=str(sid), loc=loc, host=host, ts=d.replace(hour=h, minute=random.choice([0, 15, 30])), name=cname, ctype=ctype,
                                 dur=dur, tid=tid, teacher=tname, cap=cap, uid1=hashlib.md5(str(sid).encode()).hexdigest()[:7].upper(), bookings=[]))
    d += timedelta(days=1)
sess_by_loc_day = {}
for s in sessions:
    sess_by_loc_day.setdefault((s['loc'], s['ts'].date()), []).append(s)

# ---------- purchases & visits ----------
sales, memberships, bookings = [], [], []
sale_item = 200000000; sale_id = 300000000

def add_sale(c, when, prod, seller):
    global sale_item, sale_id
    sale_item += 1; sale_id += 1
    name, cat, price, credits, days, kind = prod
    disc = round(price * random.choice([0, 0, 0, 0.1, 0.15]), 2)
    paid = round(price - disc, 2)
    vat = round(paid - paid / 1.05, 2)
    status = 'succeeded' if random.random() > 0.015 else random.choice(['failed', 'refunded'])
    voided = random.random() < 0.004
    loc = c['loc']
    sales.append({
        'Member ID': c['member_id'], 'Customer Name': f"{c['first']} {c['last']}", 'Customer Email': c['email'], 'Paying Member ID': c['member_id'],
        'Sale Item ID': str(sale_item), 'Payment Date': ts(when), 'Payment Value': f"{paid:,.2f}", 'Paid In Money Credits': '0.00', 'Payment VAT': f"{vat:,.2f}",
        'Payment Status': status, 'Payment Method': random.choice(['stripe', 'custom', 'cash', 'POS Machine']), 'Payment Transaction ID': str(sale_id + 7),
        'Stripe Token': 'custom', 'Sold By': seller or '-', 'Sale Reference': str(sale_id), 'Calculated Location': loc.strip(), 'Cleaned Product': name,
        'Cleaned Category': cat, 'Host Id': c['host'], 'Purchase Type': 'membership', 'Payment Source': 'pos', 'Paid In Event Credits': '0.00',
        'Price Excluding VAT In Currency': f"{paid - vat:,.2f}", 'Discount Value In Currency': f"{disc:,.2f}", 'Discount Code': 'SHQ20OF' if disc else '-',
        'Created At': ts(when), 'Modified At': ts(when), 'Sale ID': str(sale_id), 'Sale Total Discount Value': f"{disc:,.2f}", 'Sale Item Quantity': '1.00',
        'Sale Item Unit Price Including VAT': f"{paid:,.2f}", 'Sale Item Unit Price Excluding VAT': f"{paid - vat:,.2f}", 'Sale Item Unit VAT Amount': f"{vat:,.2f}",
        'Sale Item Unit Discount Value': f"{disc:,.2f}", 'Sec. Is Voided': 'TRUE' if voided else 'FALSE', 'Sec. Membership ID': str(sale_item + 5),
        'Sec. Membership Start Date': ts(when), 'Sec. Membership End Date': ts(when + timedelta(days=days)), 'Sec. Membership Total Classes': str(credits or '-'),
        'Sec. Membership Classes Left': '-', 'Sec. Membership Total Money': '-', 'Sec. Membership Money Left': '-', 'Sec. Membership Type': kind,
        'Sec. Membership Is Freezed': 'FALSE', 'Sec. Membership Used Session Credits': '0.00', 'Sec. Membership Revenue Per Event Credit Incl VAT': '0.00',
        'Sec. Membership Activated On First Use': '-', 'Sec. Membership Auto Renew': '-', 'Payment Item': name,
    })
    ok = status == 'succeeded' and not voided
    return ok, paid, credits, days

def book(c, when_day, product_name, paid_per_visit, category, new_label=None):
    opts = sess_by_loc_day.get((c['loc'], when_day))
    if not opts: return None
    s = random.choice(opts)
    if len(s['bookings']) >= s['cap']: return None
    r = random.random()
    late = r < 0.06
    attended = not late and (random.random() > 0.03)
    s['bookings'].append(c['member_id'])
    bookings.append(dict(member=c, s=s, product=product_name, paid=paid_per_visit if attended or late else 0, category=category,
                         attended=attended, late=late, order=s['ts'] - timedelta(hours=random.randint(1, 72)), new_label=new_label))
    return attended

for c in clients + legacy:
    is_legacy = c in legacy
    seller = random.choice(ASSOC[c['host']] + [None])
    t = c['first_visit']
    if not is_legacy:
        trial_paid = 1400 if c['trial'] == 'Studio Single Class' else 0
        book(c, t.date(), c['trial'], trial_paid, 'Complimentary/Promotional' if trial_paid == 0 else 'Sessions/Single Classes', 'New - Trial Class' if trial_paid == 0 else 'New - Paid First Visit')
        c['first_purchase'] = None
        if not c['converts']:
            continue
        t = t + timedelta(days=int(np.random.gamma(2, 6)))
    else:
        t = datetime(2024, 1, 1) + timedelta(days=random.randint(0, 90))
    # purchase loop
    prod = random.choices(PRODUCTS[:8], [8, 10, 9, 8, 14, 6, 3, 2])[0]
    loyalty = random.random()
    c['purchases'] = 0
    while t < TODAY:
        ok, paid, credits, days = add_sale(c, t.replace(hour=random.randint(9, 20), minute=random.randint(0, 59)), prod, seller)
        if not ok:
            t += timedelta(days=2); continue
        c['purchases'] += 1
        if c.get('first_purchase') is None: c['first_purchase'] = (t, prod[0], paid, prod[1])
        end = t + timedelta(days=days)
        visits = credits if credits else int(days / 7 * random.uniform(1.5, 3.5))
        per_visit = paid / max(1, credits or visits)
        used = 0
        for k in range(visits):
            vd = t + timedelta(days=int(k * days / max(1, visits)) + random.randint(0, 2))
            if vd >= min(end, TODAY): break
            book(c, vd.date(), prod[0], round(per_visit, 2), prod[1]); used += 1
        memberships.append(dict(c=c, name=prod[0], purchase=t, start=t, end=end, paid=paid, credits=credits, used=used, seller=seller, kind=prod[5]))
        # renew?
        p_renew = 0.55 + 0.35 * loyalty - (0.15 if prod[1] == 'Class Packages' else 0)
        if random.random() < p_renew:
            gap = int(np.random.normal(3, 8))
            t = end + timedelta(days=gap)
            if random.random() < 0.2: prod = random.choice(PRODUCTS[:8])
        else:
            # maybe win back later
            if random.random() < 0.18:
                t = end + timedelta(days=random.randint(95, 300)); prod = random.choice(PRODUCTS[:6])
            else:
                break

print('sales', len(sales), 'bookings', len(bookings), 'memberships', len(memberships))

def write(name, sheets):
    path = os.path.join(OUT, name)
    with pd.ExcelWriter(path, engine='xlsxwriter') as xw:
        for tab, df in sheets.items():
            df.to_excel(xw, sheet_name=tab, index=False)
    print('wrote', path)

# ---------- Sales - Raw ----------
products_df = pd.DataFrame([{'id': str(33600 + i), 'hostId': '13752', 'type': 'package-events' if p[3] else 'subscription', 'subscriptionType': 'absolute', 'name': p[0], 'price': p[2],
    'duration': p[4], 'durationUnit': 'days', 'numberOfEvents': p[3] or '', 'isIntroOffer': 'TRUE' if 'Newcomer' in p[0] else 'FALSE', 'autoRenew': 'FALSE',
    'activeSignups': random.randint(5, 400), 'hostName': 'Physique 57 Mumbai', 'isDeleted': 'FALSE', 'disabled': 'FALSE'} for i, p in enumerate(PRODUCTS)])
pricing = pd.DataFrame([{'Name': p[0], 'Host Id': '33905', 'Price': round(p[2] / 1.05), 'Validity': p[4], 'Validity Unit': 'days', 'No of Sessions': p[3] or '', 'Freeze Attempts': 1, 'Freeze Duration': 7, 'Tax': '5%', 'Price after Tax': p[2], 'Discount': '', 'Location': 'Bengaluru', 'Studios': 'Kenkere House'} for p in PRODUCTS])
sales_df = pd.DataFrame(sales)
# inject one exact duplicate row (real-world export quirk) to test de-duplication
sales_df = pd.concat([sales_df, sales_df.iloc[[5]]], ignore_index=True)
write('Sales - Raw.xlsx', {'Sales': sales_df, 'Memberships': products_df, 'Pricing Bengaluru': pricing, 'Pivot Table 24': pd.DataFrame({'x': [1]})})

# ---------- Part 4 Checkins ----------
ck = []
for b in bookings:
    s, c = b['s'], b['member']
    if s['ts'] < datetime(2024, 1, 1) or s['ts'] > TODAY: continue
    ck.append({'Member ID': c['member_id'], 'First Name': c['first'], 'Last Name': c['last'], 'Email': c['email'], 'Order At': ts(b['order'], '%Y-%m-%d, %H:%M:%S'),
        'Paid': inr(b['paid']), 'Payment Method Name': b['product'], 'Checked In': 'TRUE' if b['attended'] else 'FALSE', 'Complementary': 'FALSE',
        'Is Late Cancelled': 'TRUE' if b['late'] else 'FALSE', 'Session ID': s['session_id'], 'Session Name': s['name'], 'Capacity': s['cap'], 'Location': s['loc'].strip(),
        'Date (IST)': ts(s['ts']), 'Day of Week': s['ts'].strftime('%A'), 'Time': s['ts'].strftime('%H:%M:%S'), 'Duration (Minutes)': s['dur'], 'Teacher Name': s['teacher'],
        'Cleaned Product': b['product'], 'Cleaned Category': b['category'], 'Cleaned Class': s['name'], 'Host ID': s['host'], 'Month': s['ts'].strftime('%B'), 'Year': s['ts'].year,
        'Class No': 1 if b['attended'] else 0, 'Is New': b['new_label'] or ('Not Attended' if not b['attended'] else 'New - Others'), 'UniqueID1': s['uid1'], 'UniqueID2': s['uid1'][::-1]})
write('Day End Report - Part 4.xlsx', {'Checkins': pd.DataFrame(ck), 'Pivot Table 10': pd.DataFrame({'x': [1]})})

# ---------- Bookings history (pre-2024 imported + 2024 overlap) ----------
bk = []
for c in legacy:
    bk.append({'Member Id': c['member_id'], 'Sale Date': '2024-03-21 20:20', 'Customer Name': f"{c['first']} {c['last']}", 'Customer Email': c['email'], 'Sale Value': '₹0.00',
        'Sale Item': 'Import Visits', 'Sale Id': '100704862', 'Session Date': '2020-01-01 17:30', 'Payment Method': 'imported', 'Membership Used': '', 'Stripe Token': 'imported',
        'Refunded': '', 'Vat': '₹0.00', 'Location Name': 'Online', 'Sold By': 'Admin Admin', 'Cancelled': 'FALSE', 'Late Cancelled': 'FALSE', 'No Show': 'FALSE',
        'Trainer Id': '', 'Teacher Name': '', 'Cleaned Class': 'Unknown Class', 'Attended': 'TRUE', 'Class No': 1, 'Is New': 'New - Others', 'Day Of Week': 'Wednesday',
        'Time Slot': 'Evening', 'Host Id': '13752', 'UniqueID1': '', 'UniqueID2': ''})
for b in bookings[:5000]:  # overlapping 2024 rows — must NOT be double counted
    s, c = b['s'], b['member']
    bk.append({'Member Id': c['member_id'], 'Sale Date': ts(b['order'], '%Y-%m-%d %H:%M'), 'Customer Name': f"{c['first']} {c['last']}", 'Customer Email': c['email'], 'Sale Value': inr(b['paid']),
        'Sale Item': b['product'], 'Sale Id': '1', 'Session Date': ts(s['ts'], '%Y-%m-%d %H:%M'), 'Payment Method': 'credits', 'Membership Used': b['product'], 'Stripe Token': '',
        'Refunded': '', 'Vat': '₹0.00', 'Location Name': s['loc'].strip(), 'Sold By': '-', 'Cancelled': 'FALSE', 'Late Cancelled': 'TRUE' if b['late'] else 'FALSE', 'No Show': 'FALSE',
        'Trainer Id': s['tid'], 'Teacher Name': s['teacher'], 'Cleaned Class': s['name'], 'Attended': 'TRUE' if b['attended'] else 'FALSE', 'Class No': 1, 'Is New': 'New - Others',
        'Day Of Week': s['ts'].strftime('%A'), 'Time Slot': 'Morning', 'Host Id': s['host'], 'UniqueID1': s['uid1'], 'UniqueID2': ''})
write('Bookings Data - 2018-2026.xlsx', {'Bookings': pd.DataFrame(bk)})

# ---------- Part 3 Sessions + VC ----------
ss = []
for s in sessions:
    att = [b for b in bookings if False]  # placeholder (computed below for speed)
ck_df = pd.DataFrame(ck)
agg = ck_df.assign(att=ck_df['Checked In'].eq('TRUE'), lc=ck_df['Is Late Cancelled'].eq('TRUE'), paidv=ck_df['Paid'].str.replace('[₹,]', '', regex=True).astype(float)) \
    .groupby('Session ID').agg(checked=('att', 'sum'), lcs=('lc', 'sum'), booked=('att', 'size'), rev=('paidv', 'sum')).to_dict('index')
for s in sessions:
    a = agg.get(s['session_id'], {'checked': 0, 'lcs': 0, 'booked': 0, 'rev': 0})
    future = s['ts'] > TODAY
    ss.append({'TrainerID': s['tid'], 'FirstName': s['teacher'].split()[0], 'LastName': s['teacher'].split()[-1], 'Trainer': s['teacher'], 'SessionID': s['session_id'],
        'SessionName': s['name'], 'Capacity': s['cap'], 'CheckedIn': 0 if future else int(a['checked']), 'LateCancelled': int(a['lcs']), 'Booked': int(a['booked']), 'NonPaid': 0,
        'Location': s['loc'].strip(), 'Date': s['ts'].strftime('%Y-%m-%d'), 'Day': s['ts'].strftime('%A'), 'Time': s['ts'].strftime('%H:%M:%S'), 'Revenue': inr(a['rev']),
        'Complimentary': 0, 'UniqueID1': s['uid1'], 'UniqueID2': s['uid1'][::-1], 'Memberships': 0, 'Packages': 0, 'IntroOffers': 0, 'SingleClasses': 0, 'Type': s['ctype'],
        'Class': 'Studio Class', 'Classes': 1})
vc_rows = {}
for r in ck:
    k = r['Member ID']; m = datetime.strptime(r['Date (IST)'], '%Y-%m-%d %H:%M:%S').strftime('%b %Y')
    row = vc_rows.setdefault(k, {'Member ID': k, 'First Name': r['First Name'], 'Last Name': r['Last Name'], 'Email': r['Email'], 'Phone': '', 'Locations': r['Location']})
    row[f'{m} - Booked'] = row.get(f'{m} - Booked', 0) + 1
    row[f'{m} - Visits'] = row.get(f'{m} - Visits', 0) + (1 if r['Checked In'] == 'TRUE' else 0)
write('Day End Report - Part 3.xlsx', {'Sessions': pd.DataFrame(ss), 'VC': pd.DataFrame(list(vc_rows.values())).fillna(0), 'Recurring': pd.DataFrame({'x': [1]})})

# ---------- Part 1: New, Late Cancellations, Payroll ----------
new_rows = []
for c in legacy + clients:
    legacy_c = c in legacy
    fp = c.get('first_purchase')
    conv = (not legacy_c) and fp is not None
    retained = conv and c.get('purchases', 0) >= 2
    new_rows.append({'Member Id': c['member_id'], 'First Name': c['first'], 'Last Name': c['last'], 'Email': c['email'], 'Phone Number': c['phone'],
        'First Visit Date': ts(c['first_visit'], '%Y-%m-%d %H:%M'), 'First Visit Entity Name': 'Import Visits' if legacy_c else 'Studio Barre 57', 'First Visit Type': 'session',
        'First Visit Location': '' if legacy_c else c['loc'], 'Payment Method': 'imported' if legacy_c else 'credits', 'Membership Used': '' if legacy_c else c['trial'],
        'Home Location': c['loc'].strip(), 'Class No': '', 'Trainer Name': '', 'Is New': '' if legacy_c else 'New', 'Visits Post Trial': 0, 'Visits Post Trial Same Month': 0,
        'Late Cancellations Post Trial': 0, 'Memberships Bought Post Trial': fp[1] if fp else '', 'Purchase Count Post Trial': c.get('purchases', 0),
        'First Purchase Post Trial': fp[1] if fp else '', 'First Purchase Value': inr(fp[2], 0) if fp else '₹0', 'Ltv': '₹0', 'Retention Status': 'Not New' if legacy_c else ('Retained' if retained else 'Not Retained'),
        'Conversion Status': 'Not New' if legacy_c else ('Converted' if conv else 'Not Converted'), 'First Purchase Date': ts(fp[0], '%Y-%m-%d %H:%M') if fp else '',
        'No of Visits': 0, 'Last Visit Date': '', 'Days Since Last Visit': '', 'Conversion Span (Days)': f"{(fp[0] - c['first_visit']).days:,}" if fp else '', 'Days To Second Visit': '',
        'Unique Locations Visited Post Trial': 1, 'Month Year': c['first_visit'].strftime('%b-%Y'), 'Source': random.choice(['Social', 'Website', 'Referral', '']), 'Ltv Post Trial': '₹0',
        'Avg Purchase Value Post Trial': '₹0', 'Last Purchase Date': '', 'Last Purchase Value': '₹0', 'Total Purchases All Time': c.get('purchases', 0), 'Days Active': 0,
        'Visits Per Month': '0.00', 'Late Cancel Rate Post Trial': '0.0%', 'First Visit Day': c['first_visit'].strftime('%A'), 'First Visit Time Slot': 'Morning',
        'Conversion Speed Bucket': 'Not Converted' if not conv else '0-30 Days', 'Lifecycle Status': 'Active', 'Trial Paid Amount': '₹0', 'Trial Payment Method': '',
        'First Purchase Category': fp[3] if fp else '', 'Converted Within 30 Days': 'Not New' if legacy_c else ('Yes' if conv else 'No'), 'Visits Within 30 Days Post Trial': 0,
        'Membership Purchased Post Trial': 'Yes' if conv else 'No', 'Lead Channel': '', 'Lead Stage': '', 'Lead Associate': '', 'Lead Created Date': '', 'Days Lead To First Visit': ''})
lc = [{'Host ID': b['s']['host'], 'Report Run ID': '14306747', 'Report Generated At (IST)': '2026-11-19, 15:01:53', 'Member ID': b['member']['member_id'],
       'Customer Name': f"{b['member']['first']} {b['member']['last']}", 'Customer Email': b['member']['email'], 'Cancelled Event': b['s']['name'],
       'Cancelled Date (IST)': ts(b['s']['ts'] - timedelta(hours=3)), 'Cancelled Day': '', 'Cancelled Time': '', 'Session Date (IST)': ts(b['s']['ts']), 'Session Day': '', 'Session Time': '',
       'Paid': inr(b['paid']), 'Payment Method': 'subscription', 'Membership Name': b['product'], 'Home Location': b['member']['loc'].strip(), 'Charged Penalty Amount In Currency': random.choice([0, 0, 500])}
      for b in bookings if b['late'] and b['s']['ts'] <= TODAY]
pay = ck_df.assign(att=ck_df['Checked In'].eq('TRUE'), paidv=ck_df['Paid'].str.replace('[₹,]', '', regex=True).astype(float), mon=pd.to_datetime(ck_df['Date (IST)']).dt.strftime('%b-%Y')) \
    .groupby(['Teacher Name', 'Location', 'mon']).agg(customers=('att', 'sum'), paid=('paidv', 'sum'), sessions=('Session ID', 'nunique')).reset_index()
tid = {t[1]: t[0] for v in TEACHERS.values() for t in v}
pay_rows = [{'Teacher ID': tid.get(r['Teacher Name'], '0'), 'Teacher Name': r['Teacher Name'], 'Teacher Email': '', 'Location': r['Location'], 'Barre Sessions': r['sessions'],
             'Total Sessions': r['sessions'], 'Total Empty Sessions': 0, 'Total Non-Empty Sessions': r['sessions'], 'Total Customers': int(r['customers']), 'Total Paid': inr(r['paid'], 0),
             'Month Year': r['mon'], 'Unique Key': f"{r['Teacher Name']}-{r['Location']}-{r['mon']}", 'Converted': random.randint(0, 5), 'Conversion Rate': '30.0%', 'Retained': random.randint(0, 4),
             'Retention Rate': '20.0%', 'New': random.randint(3, 12)} for _, r in pay.iterrows()]
write('Day End Report - Part 1.xlsx', {'New': pd.DataFrame(new_rows), 'Late Cancellations': pd.DataFrame(lc), 'Payroll': pd.DataFrame(pay_rows), 'Pivot Table 32': pd.DataFrame({'x': [1]})})

# ---------- PM Leads ----------
leads = []
lid = 1100000
for c in clients:
    if random.random() < 0.55:
        lid += 1
        src, ch = random.choice(SOURCES_L)
        created = c['first_visit'] - timedelta(days=random.randint(1, 20))
        conv = c.get('first_purchase') is not None
        leads.append({'ID': str(lid), 'Full Name': f"{c['first']} {c['last']}", 'Phone Number': c['phone'], 'Email': c['email'], 'Created At': created.strftime('%Y-%m-%d'),
            'Source ID': '8080', 'Source Name': src, 'Member ID': c['member_id'], 'Converted At': created.strftime('%Y-%m-%d'), 'Stage Name': 'Membership Sold' if conv else 'Trial Completed',
            'Associate': random.choice(ASSOC[c['host']]), 'Remarks': '-', **{f'Follow Up {i} {k}': '-' for i in range(1, 5) for k in ('Date', 'Remarks')}, 'Center': c['loc'].strip(), 'Class Type': 'Barre 57',
            'Host ID': c['host'], 'Status': 'Converted' if conv else 'Trial Completed', 'Channel': ch, 'Period': 'All Time', 'UTM Source': '-', 'UTM Medium': '-', 'UTM Campaign': '-', 'UTM Term': '-', 'UTM Content': '-',
            'Purchases Count': '0.', 'LTV': '0.', 'Visits': '1.', 'Trial Status': 'Trial Completed', 'Conversion Status': 'Converted' if conv else 'Not Converted', 'Retention Status': 'Not Retained'})
for i in range(int(len(leads) * 0.8)):  # leads that never visited
    lid += 1
    loc, host, city, w = random.choice(LOCS)
    src, ch = random.choice(SOURCES_L)
    created = START + timedelta(days=random.randint(0, (TODAY - START).days))
    leads.append({'ID': str(lid), 'Full Name': 'Lead ' + str(lid), 'Phone Number': '', 'Email': '', 'Created At': created.strftime('%Y-%m-%d'), 'Source ID': '8080', 'Source Name': src, 'Member ID': '-',
        'Converted At': '-', 'Stage Name': random.choice(['Not Interested', 'Called - DNP', 'Sent Intro']), 'Associate': random.choice(ASSOC[host]), 'Remarks': '-',
        **{f'Follow Up {i} {k}': '-' for i in range(1, 5) for k in ('Date', 'Remarks')}, 'Center': loc.strip(), 'Class Type': 'Barre 57', 'Host ID': host,
        'Status': random.choice(['Lost', 'Open', 'Unresponsive']), 'Channel': ch, 'Period': 'All Time', 'UTM Source': '-', 'UTM Medium': '-', 'UTM Campaign': '-', 'UTM Term': '-', 'UTM Content': '-',
        'Purchases Count': '0.', 'LTV': '0.', 'Visits': '0.', 'Trial Status': 'Not Tried', 'Conversion Status': 'Not Converted', 'Retention Status': 'Not Retained'})
meta = []
d = datetime(2026, 1, 1)
while d < TODAY:
    for camp in ['MUM-Bandra-Leads', 'MUM-Kemps-Leads', 'BLR-Kenkere-Leads']:
        sp = random.uniform(1500, 4000); ld = np.random.poisson(sp / 900)
        meta.append({'date': d.strftime('%Y-%m-%d'), 'account_id': '2148150425', 'account_name': 'Physique 57', 'campaign_id': str(abs(hash(camp)) % 10**10), 'campaign_name': camp,
                     'objective': 'OUTCOME_LEADS', 'adset_id': '', 'adset_name': '', 'ad_id': '', 'ad_name': '', 'publisher_platform': 'instagram', 'impressions': int(sp * 2.2),
                     'reach': int(sp * 1.7), 'frequency': 1.3, 'spend': round(sp, 6), 'clicks': int(sp / 20), 'inline_link_clicks': int(sp / 30), 'ctr': 2.1, 'cpc': 20, 'cpm': 450,
                     'leads': ld, 'on_facebook_leads': 0, 'purchases': 0, 'purchase_value': 0, 'add_to_cart': 0, 'initiate_checkout': 0, 'cpl': '', 'cpa': '', 'roas': ''})
    d += timedelta(days=1)
write('❖ PM - Leads ❖.xlsx', {'◉ Leads': pd.DataFrame(leads), 'Meta_Daily_Data': pd.DataFrame(meta), 'Tasks': pd.DataFrame([{'Host ID': '13752', 'Task ID': '1', 'Task Title': 'Check-in'}]),
                              'Sales': pd.DataFrame(sales[:500])})

# ---------- Lapsed New ----------
lap = []
for m in memberships:
    c = m['c']
    status = 'Active' if m['end'] > TODAY else 'Expired'
    lap.append({'Member Name': f"{c['first']} {c['last']}", 'Member ID': c['member_id'], 'Member Email': c['email'], 'Member Phone': c['phone'], 'Host ID': c['host'], 'Status': status,
        'Membership Name': m['name'], 'Sessions Included': m['credits'] or '', 'Purchase Date': ts(m['purchase']), 'Start Date': ts(m['start']), 'End Date': ts(m['end']),
        'Churned Date': ts(m['end']) if status == 'Expired' else '', 'Amount Paid': inr(m['paid']), 'Discount Code': '', 'Discount Amount': '₹0.00', 'Original Price': inr(m['paid']),
        'Sold By': m['seller'] or '-', 'Created By': '-', 'Most Recent Visit': '', 'First Visit': '', 'Total Sessions': m['used'], 'Sessions Attended': m['used'], 'Remaining Sessions': 0,
        'Total Cancellations': 0, 'Late Cancellations': 0, 'No Shows': 0, 'Cancellation Rate': '0%', 'Preferred Time': 'Morning', 'Primary Location': c['loc'].strip(),
        'Locations Visited': c['loc'].strip(), 'Membership Type': m['kind'], 'Days Frozen': 0, 'Membership Duration': (m['end'] - m['start']).days, 'Days Active': 0,
        'Days Since Last Visit': 0, 'Average Visits Per Week': 0, 'Revenue Per Visit': 0, 'Attendance Rate': '0%', 'Lapse Gap': 0, 'Derived Segment': ''})
write('Lapsed New.xlsx', {'Lapsed': pd.DataFrame(lap), 'Excluded Memberships': pd.DataFrame({'Excluded Membership': ['Studio Open Barre Class'], 'Excluded Reason': ['Trial']}),
                          'Consolidated Members': pd.DataFrame(lap[:100])})
print('done')

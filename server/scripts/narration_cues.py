# Builds the narration manifest (clips + timed focus cues) for server/src/report/narration.ts.
# Usage: python3 -I server/scripts/narration_cues.py <narration-package-dir> > tracks.json
# Needs <dir>/timestamps/word-timestamps.csv (measured per-word start times) for exact cue timing.
import csv,sys,json,os,re
n=sys.argv[1]
SEC_DEFAULT={'1':'glance','2':'glance','3':'glance','4':'sales','5':'funnel','6':'attendance','7':'trainers','8':'formats','9':'churn','10':'closing','11':'closing','12':'closing','13':'closing'}
MIXED={'1','3','10','13'}
KW=[('sales',r'revenue|lakh|transaction|discount|single-class|retail|package|pack|ticket|A T V|selling|sales'),
    ('funnel',r'\blead|trial|conversion|convert|newcomer|funnel|front door|acquisition'),
    ('classes',r'\bslot|schedule|fill rate|\bfill\b|empty class|class size|capacity|a\.m\.|p\.m\.|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday'),
    ('attendance',r'attendance|visit|check-in|booking|cancel|no-show|late cancel'),
    ('trainers',r'trainer|instructor'),
    ('formats',r'barre|powercycle|strength lab|format|cross-format'),
    ('churn',r'churn|lapse|renew|retention|expir')]
TERMS=[('revenue','Revenue'),('transactions','Transactions'),('paying clients','Paying'),('average transaction value','ATV'),('A T V','ATV'),('discount','Discount'),
 ('single-class','Single'),('retail','Retail'),('leads','Leads'),('trial','Trial'),('conversion','Conversion'),('visits','Visits'),('bookings','Booking'),('cancel','Cancel'),
 ('no-show','No-show'),('fill','Fill'),('class size','Class size'),('empty','Empty'),('capacity','Capacity'),('churn','Churn'),('lapse','Lapse'),('renew','Renew'),
 ('barre','Barre'),('powercycle','powerCycle'),('strength lab','Strength'),('new client','New'),('members','Member'),('yield','Yield'),('rate','Rate')]
STOP=set('The A An It In On At Of October September November August April January March Kwality House Rs Recommendation Owner Measure Head This That Net Strip At Monday Tuesday Wednesday Thursday Friday Saturday Sunday G S T Trial Completed WhatsApp'.split())
NUM=re.compile(r'(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s+(lakh|crore))?(?:\s+(percentage points|percent|rupees))?',re.I)
def nums(s):
    out=[]
    for m in NUM.finditer(s):
        v=float(m.group(1).replace(',','')); big=(m.group(2) or '').lower(); unit=(m.group(3) or '').lower()
        if not big and not unit and (1990<=v<=2035 or v<13): continue   # years, small counts, times of day
        if big=='lakh': v*=1e5
        if big=='crore': v*=1e7
        u='pp' if unit=='percentage points' else '%' if unit=='percent' else ''
        out.append({'v':round(v,2),'u':u})
    return out
def classify(s,secnum):
    sec=SEC_DEFAULT[secnum]
    hits=[(k,len(re.findall(p,s,re.I))) for k,p in KW]; best=max(hits,key=lambda x:x[1])
    if secnum in MIXED and best[1]>0: sec=best[0]
    if secnum=='6' and best[0]=='classes' and best[1]>0: sec='classes'
    return sec
def cues(words,secnum):
    """words: [(word,start)] in script order. One cue per clause; exact start = first word's measured time."""
    clauses=[]; cur=[]
    for w,t in words:
        cur.append((w,t))
        if re.search(r'[.;:—]$|,$',w) or w=='—': clauses.append(cur); cur=[]
    if cur: clauses.append(cur)
    out=[]; sent=''
    for c in clauses:
        text=' '.join(w for w,_ in c)
        if not out or re.search(r'[.;]$', out[-1].get('_end','.')): sent=text
        sec=classify(text if len(text.split())>4 else sent,secnum)
        t=[lbl for k,lbl in TERMS if re.search(re.escape(k),text,re.I)]
        names=[x for x in re.findall(r'\b[A-Z][a-z]{2,}\b',text) if x not in STOP]
        terms=list(dict.fromkeys(names[:3]+t))[:5]; ns=nums(text)
        cue={'at':round(c[0][1],2),'sec':sec,'terms':terms,'nums':ns,'_end':c[-1][0]}
        if out and not ns and (not terms or terms==out[-1]['terms']) and sec==out[-1]['sec']: out[-1]['_end']=cue['_end']; continue
        out.append(cue)
    for c in out: c.pop('_end',None)
    # a clause with nothing to point at keeps the previous highlight (except the clip's opening cue)
    return [c for i,c in enumerate(out) if i==0 or c['terms'] or c['nums']]
WT={}
for r in csv.DictReader(open(os.path.join(n,'timestamps','word-timestamps.csv'))): WT.setdefault(r['clip'],[]).append((r['word'],float(r['start'])))
def parse(md,hdr):
    t=open(os.path.join(n,md)).read(); res={}
    for m in re.finditer(hdr+r'(.*?)\n\n(.*?)(?=\n#{2,4} |\Z)',t,re.S): res[m.group(1)]=' '.join(m.group(3).split())
    return res
P=parse('narration-script.md',r'#### Paragraph (\d+) ')
R=parse('recommendations-script.md',r'#### (R\d+) ')
def track(f,key,secf,txt,secnum):
    out=[]
    for r in csv.DictReader(open(os.path.join(n,f))):
        d=float(r['seconds']); s=secnum(r)
        out.append({'id':r[key],'section':r[secf],'file':r['file'],'seconds':d,'home':SEC_DEFAULT[s],'cues':cues(WT[r[key]],s)})
    return out
tracks=[{'id':'report','title':'Full report narration','clips':track('clip-index.csv','paragraph','section',P,lambda r:r['section'].split('.')[0])},
        {'id':'recs','title':'Recommendations R1–R12','clips':track('rec-index.csv','item','tier',R,lambda r:'12')}]
print(json.dumps(tracks,indent=1,ensure_ascii=False))

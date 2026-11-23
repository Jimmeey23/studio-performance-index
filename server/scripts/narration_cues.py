# Builds the narration manifest (clips + timed focus cues) for server/src/report/narration.ts.
# Usage: python3 -I server/scripts/narration_cues.py <narration-package-dir> > tracks.json
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
def cues(text,secnum,dur):
    sents=re.split(r'(?<=[.;])\s+(?=[A-Z0-9])',text.strip()); words=len(text.split()); out=[]; w=0
    for s in sents:
        sec=SEC_DEFAULT[secnum]
        hits=[(k,len(re.findall(p,s,re.I))) for k,p in KW]; best=max(hits,key=lambda x:x[1])
        if secnum in MIXED and best[1]>0: sec=best[0]
        if secnum=='6' and best[0]=='classes' and best[1]>0: sec='classes'
        t=[lbl for k,lbl in TERMS if re.search(re.escape(k),s,re.I)]
        names=[x for x in re.findall(r'\b[A-Z][a-z]{2,}\b',s) if x not in STOP]
        terms=list(dict.fromkeys(names[:3]+t))[:5]
        at=round(dur*w/words,1); w+=len(s.split())
        if out and out[-1]['sec']==sec and out[-1]['terms']==terms: continue
        out.append({'at':at,'sec':sec,'terms':terms})
    return out
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
        out.append({'id':r[key],'section':r[secf],'file':r['file'],'seconds':d,'home':SEC_DEFAULT[s],'cues':cues(txt[r[key]],s,d)})
    return out
tracks=[{'id':'report','title':'Full report narration','clips':track('clip-index.csv','paragraph','section',P,lambda r:r['section'].split('.')[0])},
        {'id':'recs','title':'Recommendations R1–R12','clips':track('rec-index.csv','item','tier',R,lambda r:'12')}]
print(json.dumps(tracks,indent=1,ensure_ascii=False))

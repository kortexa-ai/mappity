"""Compare actual Mappity endpoints with frozen OSM input and explicit Shingi targets.

No service management, model changes or calibration fitting. Each client runs in an
isolated temporary directory; complete source hashes, events and answers are saved.
"""
import argparse
import hashlib
import json
import math
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--cache-file', type=Path, required=True, help='frozen OSM tile values JSON from a previous run')
parser.add_argument('--shingi-url', required=True)
parser.add_argument('--callers', default='4,8', help='comma-separated concurrency limits; alternate order each round')
parser.add_argument('--rounds', type=int, default=3)
parser.add_argument('--port', type=int, default=4397)
args=parser.parse_args()
callers=[int(x) for x in args.callers.split(',')]
if not callers or any(x<1 or x>64 for x in callers) or not 1<=args.rounds<=20:
    parser.error('callers must be 1..64 and rounds 1..20')
ROOT=Path(__file__).resolve().parents[1]
OUT=args.out
BASELINE=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
PORT=args.port
SHINGI_URL=args.shingi_url.rstrip('/')
PAYLOAD={'text':'somewhere to sit with a hot drink and watch the rain','view':{'center':[-122.3421,47.6097],'bbox':[-122.3520,47.6040,-122.3320,47.6150]}}
OUT.mkdir(parents=True,exist_ok=True)
if (OUT/'results.json').exists():
    raise SystemExit('Refusing to overwrite an existing comparison')
cache=json.loads(args.cache_file.read_text())
if not isinstance(cache, dict) or any(Path(name).name != name or not name.endswith('.json') for name in cache):
    raise SystemExit('Frozen cache keys must be plain JSON filenames')
(OUT/'frozen-osm-cache.json').write_text(json.dumps(cache,sort_keys=True)+'\n')
with urllib.request.urlopen(SHINGI_URL+'/v1/version',timeout=10) as r:
    version=json.load(r)
report={'baseline':BASELINE,'version':version,'callers':callers,'method':'Actual HTTP search/game; frozen OSM with refreshed timestamps; alternating concurrency order each round; externally managed model. Per-run version/cache counters and complete events retained. Random game secret does not change its 60 judged places.',
        'fixture_sha256':hashlib.sha256((OUT/'frozen-osm-cache.json').read_bytes()).hexdigest(),'payload':PAYLOAD,'sources':{},'runs':[]}

def save():
    (OUT/'results.json').write_text(json.dumps(report,indent=2)+'\n')

def post(path,body):
    return urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{PORT}'+path,data=json.dumps(body).encode(),headers={'content-type':'application/json'}),timeout=240)


def run(label,mode,cwd):
    with socket.socket() as s:
        if s.connect_ex(('127.0.0.1',PORT))==0:
            raise RuntimeError('test port already in use')
    env=dict(os.environ,JEV_PROVIDER='shingi',SHINGI_URL=SHINGI_URL,PORT=str(PORT))
    with (OUT/f'{label}-server.log').open('w') as log:
        process=subprocess.Popen([shutil.which('node'),'--env-file='+str(ROOT/'.env'),'server/index.js'],cwd=cwd,env=env,stdout=log,stderr=log)
        try:
            for _ in range(100):
                with socket.socket() as s:
                    if s.connect_ex(('127.0.0.1',PORT))==0: break
                if process.poll() is not None: raise RuntimeError('test server exited')
                time.sleep(.05)
            with urllib.request.urlopen(SHINGI_URL+'/v1/version',timeout=10) as r: version_before=json.load(r)
            started=time.perf_counter(); events=[]
            with post('/api/ask',PAYLOAD) as response,(OUT/f'{label}-search.ndjson').open('w') as f:
                for line in response:
                    event=json.loads(line); events.append(event);f.write(json.dumps(event)+'\n');f.flush()
                    if event['step'] in ('route','places','kinds','shortlist','done','error'):
                        print(label,event['step'],round(time.perf_counter()-started,3),{k:event[k] for k in ['cached','count','judged','outcome','ms','message'] if k in event},flush=True)
            assert events[-1]['step']=='done' and events[-1]['outcome']=='searched'
            assert all(events[-1][key]==value for key,value in
                       [('requests',303),('judgments',425),('tokens',66717)]), 'fixed search work changed'
            places=next(e for e in events if e['step']=='places')
            assert places['cached'], 'frozen place cache missed'
            assert places['count']==693, 'frozen place count changed'
            scores={pid:p for e in events if e['step']=='judge' for pid,p,*rest in e['scores']}
            assert len(scores)==300 and all(math.isfinite(p) and 0<=p<=1 for p in scores.values())
            with post('/api/game/start',{'center':[-122.3421,47.6097],'radiusM':611}) as r:
                game=json.load(r)
            assert len(game['places'])==60
            answers=[]
            for question in ['Is this place a cafe?','Which of these places is the best?']:
                with post('/api/game/ask',{'id':game['id'],'question':question}) as r:
                    answer=json.load(r)
                answers.append({'question':question,**answer})
                print(label,'game',round(answer['ms']/1000,3),answer['askable'],flush=True)
            assert answers[0]['askable'] and not answers[1]['askable']
            assert answers[0]['judgments']==61 and answers[1]['judgments']==1
            assert all(math.isfinite(p) and 0<=p<=1 for _,p in answers[0]['odds'])
            assert abs(sum(p for _,p in answers[0]['odds'])-1)<1e-8
            (OUT/f'{label}-game.json').write_text(json.dumps({'start':game,'answers':answers},indent=2)+'\n')
            with urllib.request.urlopen(SHINGI_URL+'/v1/version',timeout=10) as r: version_after=json.load(r)
            report['runs'].append({'label':label,'callers':mode,'version_before':version_before,'version_after':version_after,'search':events[-1],'places':places['count'],'scores':scores,
                                   'game_valid_ms':answers[0]['ms'],'game_invalid_ms':answers[1]['ms']})
            save()
        finally:
            process.terminate()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.kill();process.wait()

with tempfile.TemporaryDirectory(prefix='mappity-parallel-') as directory:
    dirs={}
    files=subprocess.check_output(['git','ls-tree','-r','--name-only',BASELINE,'server'],cwd=ROOT,text=True).splitlines()
    for mode in callers:
        cwd=Path(directory)/str(mode); (cwd/'server').mkdir(parents=True);(cwd/'.cache').mkdir()
        (cwd/'package.json').write_text('{"type":"module"}')
        (cwd/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
        report['sources'][mode]={}
        for name in files:
            data=(ROOT/name).read_bytes()
            if name in ('server/game.js','server/pipeline.js'):
                text=data.decode()
                pattern=r'(local \? )\d+( : Infinity)' if name.endswith('game.js') else r'(jev\.provider === "shingi" \? )\d+( : Infinity)'
                text,count=re.subn(pattern,lambda m:f'{m[1]}{mode}{m[2]}',text)
                if count!=1: raise RuntimeError('Concurrency patch no longer matches '+name)
                data=text.encode()
            (cwd/name).parent.mkdir(parents=True,exist_ok=True);(cwd/name).write_bytes(data)
            report['sources'][mode][name]=hashlib.sha256(data).hexdigest()
        for name,value in cache.items():
            (cwd/'.cache'/name).write_text(json.dumps({'at':time.time()*1000,'value':value}))
        dirs[mode]=cwd
    save()
    for round_index in range(args.rounds):
        for mode in callers if round_index%2==0 else callers[::-1]:
            run(f'round{round_index+1}-{mode}',mode,dirs[mode])
report['finished']=True
save()

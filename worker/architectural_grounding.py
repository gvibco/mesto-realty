"""Convert bounded plan observations into metric meshes; verify raster gaps."""
import base64,io,math
from PIL import Image
import numpy as np

KINDS={'sofa':.85,'armchair':.85,'table':.75,'chair':.9,'bed':.65,'cabinet':1.8,'kitchen':.9,'sink':.9,'toilet':.8,'desk':.75,'shelf':1.8}

def number(v):
    if type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=1000:raise ValueError('Invalid observation coordinate')
    return float(v)

def point(v):
    if not isinstance(v,list) or len(v)!=2:raise ValueError('Invalid point')
    return [number(n) for n in v]

def box(v):
    if isinstance(v,dict):
        if set(v)!={'box'}:raise ValueError('Invalid opening observation')
        v=v['box']
    if not isinstance(v,list) or len(v)!=4:raise ValueError('Invalid box')
    v=[number(n) for n in v]
    if v[2]<=v[0] or v[3]<=v[1]:raise ValueError('Empty observation')
    return v

def runs(values):
    indices=np.flatnonzero(values)
    if not len(indices):return []
    splits=np.split(indices,np.flatnonzero(np.diff(indices)>1)+1)
    return [(int(a[0]),int(a[-1])+1) for a in splits]

def grounded_scene(raw,dimensions,encoded_plan):
    required={'building','walls','windows','doors','furniture'}
    if not isinstance(raw,dict) or not required<=set(raw) or set(raw)-required-{'columns'}:raise ValueError('Invalid observations')
    for k,limit in [('walls',500),('windows',500),('doors',500),('furniture',300),('columns',300)]:
        if not isinstance(raw.get(k,[]),list) or len(raw.get(k,[]))>limit:raise ValueError('Too many observations')
    bounds=box(raw['building'])
    for k in ('width','depth','height'):
        if type(dimensions.get(k)) not in (int,float) or not math.isfinite(dimensions[k]) or dimensions[k]<=0:raise ValueError('Invalid dimensions')
    data=base64.b64decode(encoded_plan,validate=True)
    if len(data)>8*1024*1024:raise ValueError('Image too large')
    with Image.open(io.BytesIO(data)) as image:
        if image.width*image.height>4_000_000:raise ValueError('Image too large')
        pixels=np.asarray(image.convert('RGB'))
    h,w=pixels.shape[:2];scale=np.array([w/1000,h/1000])
    # Plans range from black-on-white to light grey strokes; pick the stroke
    # threshold per image (Otsu), clamped so shading never counts as a stroke.
    gray=pixels.max(axis=2)
    hist=np.bincount(gray.ravel(),minlength=256).astype(np.float64)
    total=gray.size;sum_total=float((hist*np.arange(256)).sum())
    sum_b=0.0;w_b=0.0;best=-1.0;threshold=128
    for t in range(256):
        w_b+=hist[t]
        if w_b<=0:continue
        w_f=total-w_b
        if w_f<=0:break
        sum_b+=t*hist[t]
        m_b=sum_b/w_b;m_f=(sum_total-sum_b)/w_f
        between=w_b*w_f*(m_b-m_f)**2
        if between>best:best=between;threshold=t
    dark=gray<=min(210,max(80,threshold))
    tolerance=max(3,min((bounds[2]-bounds[0])*scale[0],(bounds[3]-bounds[1])*scale[1])*.04)
    observations=[]
    for row in raw['walls']:
        if not isinstance(row,dict) or set(row)!={'start','end','exterior'} or type(row['exterior']) is not bool:raise ValueError('Invalid wall')
        a=np.array(point(row['start']))*scale;b=np.array(point(row['end']))*scale
        delta=b-a
        if np.linalg.norm(delta)<2:raise ValueError('Empty wall')
        axis=0 if abs(delta[0])>=abs(delta[1]) else 1;cross=1-axis
        thickness=None
        # Verify and centre orthogonal walls on their actual drawn stroke.
        if abs(delta[cross])<=tolerance:
            lo=max(0,int(min(a[axis],b[axis])));hi=min([w,h][axis],int(max(a[axis],b[axis]))+1)
            mid=(a[cross]+b[cross])/2;clo=max(0,int(mid-tolerance));chi=min([w,h][cross],int(mid+tolerance)+1)
            strip=dark[clo:chi,lo:hi] if axis==0 else dark[lo:hi,clo:chi].T
            coverage=strip.sum(axis=1)
            if not len(coverage) or coverage.max()<max(5,(hi-lo)*.25):raise ValueError('Wall not supported by raster')
            strokes=runs(coverage>=coverage.max()*.8)
            stroke=min(strokes,key=lambda r:abs(clo+(r[0]+r[1]-1)/2-mid))
            centre=clo+(stroke[0]+stroke[1]-1)/2
            a[cross]=b[cross]=centre;thickness=stroke[1]-stroke[0]
        else:
            # A closed polygon alone does not prove diagonal strokes exist.
            vector=b-a;length=float(np.linalg.norm(vector));normal=np.array([-vector[1],vector[0]])/length
            steps=np.linspace(.05,.95,min(2000,max(20,int(length))))
            offsets=np.arange(-int(tolerance),int(tolerance)+1)
            samples=a+steps[:,None]*vector
            grid=samples[:,None,:]+offsets[None,:,None]*normal
            xs=np.rint(grid[:,:,0]).astype(int);ys=np.rint(grid[:,:,1]).astype(int)
            valid=(xs>=0)&(xs<w)&(ys>=0)&(ys<h)
            support=np.zeros_like(valid);support[valid]=dark[ys[valid],xs[valid]]
            if support.any(axis=1).mean()<.4:raise ValueError('Diagonal wall not supported by raster')
        observations.append({'a':a,'b':b,'exterior':row['exterior'],'axis':axis,'thickness':thickness})
    # Snap near intersections, retaining only relationships visible in the plan.
    for wall in observations:
        for p in (wall['a'],wall['b']):
            for other in observations:
                if wall is other or wall['axis']==other['axis'] or other['thickness'] is None:continue
                axis=wall['axis'];coord=other['a'][axis]
                if abs(p[axis]-coord)<=tolerance and min(other['a'][1-axis],other['b'][1-axis])-tolerance<=p[1-axis]<=max(other['a'][1-axis],other['b'][1-axis])+tolerance:p[axis]=coord
    exterior=[o for o in observations if o['exterior']]
    if len(exterior)<3:raise ValueError('Missing exterior')
    # Exterior must form one real closed cycle; no rectangular fallback.
    key=lambda p:tuple(round(float(n),2) for n in p)
    graph={}
    for o in exterior:
        a,b=key(o['a']),key(o['b'])
        if a==b:raise ValueError('Collapsed wall')
        graph.setdefault(a,[]).append(b);graph.setdefault(b,[]).append(a)
    if any(len(v)!=2 for v in graph.values()):raise ValueError('Exterior is not closed')
    start=min(graph);cycle=[start];previous=None;current=start
    for _ in range(len(graph)):
        nxt=next(v for v in graph[current] if v!=previous)
        if nxt==start:break
        if nxt in cycle:raise ValueError('Invalid exterior topology')
        cycle.append(nxt);previous,current=current,nxt
    if len(cycle)!=len(graph) or start not in graph[current]:raise ValueError('Disconnected exterior')
    coords=np.array(cycle);origin=coords.min(axis=0);extent=coords.max(axis=0)-origin
    if np.any(extent<=0):raise ValueError('Empty building')
    factor=np.array([dimensions['width'],dimensions['depth']])/extent
    # Thick structural strokes must be covered by observations. Otherwise a
    # missed partition could silently become a generic empty room.
    import cv2
    structural=dark.astype(np.uint8)
    margin=int(math.ceil(tolerance))
    inside=np.zeros_like(structural)
    xmin=max(0,int(origin[0])-margin);xmax=min(w,int(origin[0]+extent[0])+margin+1)
    ymin=max(0,int(origin[1])-margin);ymax=min(h,int(origin[1]+extent[1])+margin+1)
    inside[ymin:ymax,xmin:xmax]=structural[ymin:ymax,xmin:xmax]
    for row in raw['furniture']:
        if not isinstance(row,dict) or set(row)!={'kind','box'}:raise ValueError('Invalid furniture')
        f=box(row['box']);a=np.array(f[:2])*scale;b=np.array(f[2:])*scale
        inside[max(0,int(a[1])):min(h,int(b[1])+1),max(0,int(a[0])):min(w,int(b[0])+1)]=0
    for axis in (0,1):
        length=max(20,int(.3/factor[axis]))
        kernel=np.ones((5,length) if axis==0 else (length,5),np.uint8)
        lines=cv2.morphologyEx(inside,cv2.MORPH_OPEN,kernel)
        count,labels,stats,centres=cv2.connectedComponentsWithStats(lines,8)
        for index in range(1,count):
            x,y,bw,bh,area=stats[index];long=bw if axis==0 else bh;short=bh if axis==0 else bw
            if long<length or long<3*short:continue
            centre=centres[index];matched=False
            for o in observations:
                if o['axis']!=axis:continue
                cross=1-axis
                if abs(centre[cross]-o['a'][cross])>max(tolerance,short):continue
                if min(o['a'][axis],o['b'][axis])-tolerance<=centre[axis]<=max(o['a'][axis],o['b'][axis])+tolerance:
                    matched=True;break
            if not matched:raise ValueError('Missing structural wall observation')
    metric=lambda p:[round(float(n),5) for n in ((np.array(p)-origin)*factor)]
    scene={'version':1,**dimensions,'floors':[{'points':[metric(p) for p in cycle],'tone':'neutral'}],'walls':[],'openings':[],'columns':[],'furniture':[],'warnings':['Размеры мебели приблизительные','Часть деталей не удалось определить по исходным данным']}
    for i,o in enumerate(observations):
        thick=o['thickness']*factor[1-o['axis']] if o['thickness'] else .15
        if not .04<=thick<=1:raise ValueError('Invalid wall thickness')
        scene['walls'].append({'id':f'w{i+1}','start':metric(o['a']),'end':metric(o['b']),'thickness':round(float(thick),5),'exterior':o['exterior']})
    for kind in ('windows','doors'):
        for entry in raw[kind]:
            b=box(entry);low=np.array(b[:2])*scale;high=np.array(b[2:])*scale;centre=(low+high)/2
            def distance(o):
                v=o['b']-o['a'];t=np.clip(np.dot(centre-o['a'],v)/np.dot(v,v),0,1)
                return np.linalg.norm(centre-(o['a']+t*v))
            idx=min(range(len(observations)),key=lambda i:distance(observations[i]));o=observations[idx]
            if o['thickness'] is None:raise ValueError('Unsupported diagonal opening')
            axis=o['axis'];cross=1-axis;c=int(round(o['a'][cross]));lo=int(round(min(o['a'][axis],o['b'][axis])));hi=int(round(max(o['a'][axis],o['b'][axis])))
            if not low[cross]-tolerance<=c<=high[cross]+tolerance:raise ValueError('Opening observation does not touch wall')
            samples=dark[c,lo:hi+1] if axis==0 else dark[lo:hi+1,c]
            gaps=[(lo+a,lo+z) for a,z in runs(~samples) if z-a>=max(3,.1/factor[axis])]
            supported=[g for g in gaps if min(g[1],high[axis])-max(g[0],low[axis])>0]
            if not supported:raise ValueError('Opening not supported by raster')
            g=max(supported,key=lambda g:min(g[1],high[axis])-max(g[0],low[axis]))
            offset=(g[0]-o['a'][axis]) if o['b'][axis]>o['a'][axis] else (o['a'][axis]-g[1])
            width=(g[1]-g[0])*factor[axis]
            opening={'wallId':f'w{idx+1}','kind':'window' if kind=='windows' else 'door','offset':round(float(max(0,offset)*factor[axis]),5),'width':round(float(width),5),'bottom':min(.9,dimensions['height']*.3) if kind=='windows' else 0,'height':min(1.5,dimensions['height']*.5) if kind=='windows' else min(2.1,dimensions['height'])}
            if opening not in scene['openings']:scene['openings'].append(opening)
    seen=set()
    for kind,rows in [('furniture',raw['furniture']),('columns',raw.get('columns',[]))]:
        for row in rows:
            if kind=='furniture':
                if not isinstance(row,dict) or set(row)!={'kind','box'} or row['kind'] not in KINDS:raise ValueError('Invalid furniture')
                b=box(row['box'])
            else:b=box(row)
            identity=(kind,row.get('kind') if isinstance(row,dict) else None,tuple(b))
            if identity in seen:continue
            seen.add(identity);low=np.array(b[:2])*scale;high=np.array(b[2:])*scale
            if np.any(low<origin-tolerance) or np.any(high>origin+extent+tolerance):raise ValueError('Object outside building')
            size=(high-low)*factor
            obj={'position':metric((low+high)/2),'width':round(float(size[0]),5),'depth':round(float(size[1]),5),'height':dimensions['height'] if kind=='columns' else min(KINDS[row['kind']],dimensions['height'])}
            if kind=='furniture':obj.update(kind=row['kind'],rotation=0)
            scene[kind].append(obj)
    return scene

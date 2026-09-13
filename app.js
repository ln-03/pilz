'use strict';
const RANKS=['kingdom','phylum','class','order','family','genus','species'];
const RANK_DE={kingdom:'Fungi',phylum:'Stamm',class:'Klasse',order:'Ordnung',family:'Familie',genus:'Gattung',species:'Art'};
const TAX_FILTER_RANKS=['phylum','class','order','family','genus','species'];
const TAX_FILTER_IDS={phylum:'taxFilterPhylum',class:'taxFilterClass',order:'taxFilterOrder',family:'taxFilterFamily',genus:'taxFilterGenus',species:'taxFilterSpecies'};
const COLORS={Basidiomycota:[1,.23,.58],Ascomycota:[.22,.78,.43],other:[.55,.6,.86],root:[.72,.76,.84]};
const INAT={base:'https://api.inaturalist.org/v1',placeId:'125296',fungiTaxonId:'47170'};
const TRAITS={
 phylum:['Kurzdiagnose','Lebensweise / Ökologie'], class:['Kurzdiagnose','Fruchtkörpertyp'], order:['Kurzdiagnose','Hymenium / Fruchtschicht','Ökologie'], family:['Habitus','Hymenophor','Velum / Hülle','Ökologie'],
 genus:['Hut','Stiel','Lamellen / Röhren / Poren','Fleisch / Verfärbung','Geruch / Geschmack (nur dokumentieren)','Sporenpulverfarbe','Sporenform','Sporenornament','Zystiden','Basidien / Asci','Hyphensystem / Schnallen','Reaktionen / Reagenzien','Substrat / Wirt','Habitat'],
 species:['Hut','Stiel','Lamellen / Röhren / Poren','Fleisch / Verfärbung','Geruch / Geschmack (nicht als Verzehrtest)','Sporenpulverfarbe','Sporenform','Sporengröße','Sporenornament','Zystiden','Basidien / Asci','Hyphensystem / Schnallen','Reaktionen / Reagenzien','Substrat / Wirt','Habitat','Phänologie']
};
let raw=[],nodes=[],byId=new Map(),selected=null,cutoff='species',filters={};
let gl,prog,bufLines,bufPoints,loc={},camera={yaw:-.42,pitch:.24,zoom:5.15},pointer={down:false,x:0,y:0,moved:false},hoverNode=null;
let theme=localStorage.getItem('pilzraum-theme')||'dark';
const VISUAL_DEFAULTS={length:{phylum:.86,class:1.00,order:.88,family:.66,genus:.46,species:.28},angle:{phylum:158,class:58,order:38,family:24,genus:15,species:9},pathBrightness:.48,pathThickness:1,speciesSize:25};
let visualSettings=loadVisualSettings();
let subsetLayoutMode='global';
let subsetSettings=JSON.parse(JSON.stringify(visualSettings));
let noteCache=new Map();
const dbPromise=openDB(); const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

async function init(){
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  await loadNoteCache();
  const base=await fetch('./data/taxa.json').then(r=>r.json()); const added=await idbGetAddedTaxa();
  raw=mergeTaxa(base,added); buildTree(raw); initUI(); initGL(); resize(); render();
  addEventListener('resize',()=>{resize();render()});
}
function mergeTaxa(a,b){const m=new Map();for(const x of a)m.set(String(x.id),x);for(const x of b){const k=String(x.id);m.set(k,m.has(k)?{...x,...m.get(k)}:x)}return [...m.values()]}
function buildTree(data){
  byId=new Map(); nodes=data.map(d=>({...d,id:String(d.id),parent_id:d.parent_id==null?null:String(d.parent_id),children:[],parent:null,pos:[0,0,0],dir:[0,0,1],aggObs:d.obs_count||0}));
  nodes.forEach(n=>byId.set(n.id,n)); nodes.forEach(n=>{if(n.parent_id&&byId.has(n.parent_id)){n.parent=byId.get(n.parent_id);n.parent.children.push(n)}});
  let roots=nodes.filter(n=>!n.parent); roots.forEach(sortTree);
  if(!roots.some(n=>n.rank==='kingdom'&&n.name==='Fungi')){
    const fungi={id:'fungi-root-local',parent_id:null,name:'Fungi',rank:'kingdom',children:[...roots],parent:null,pos:[0,0,0],dir:[0,0,1],aggObs:0,synthetic:true};
    roots.forEach(r=>{r.parent=fungi;r.parent_id=fungi.id});nodes.push(fungi);byId.set(fungi.id,fungi);roots=[fungi];
  }
  const root=roots.find(n=>n.rank==='kingdom'&&n.name==='Fungi')||roots[0];
  layoutTree(visualSettings,null,root);
  const agg=n=>{n.aggObs=n.rank==='species'?(n.obs_count||0):(n.children||[]).reduce((sum,c)=>sum+agg(c),0);return n.aggObs};roots.forEach(agg);
  assignClassColors();
}
function layoutTree(settings,activeSet=null,rootOverride=null){
  const root=rootOverride||nodes.find(n=>n.rank==='kingdom'&&n.name==='Fungi')||nodes.find(n=>!n.parent);if(!root)return;
  const norm=v=>{const q=Math.hypot(...v)||1;return v.map(x=>x/q)};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const add=(a,b)=>a.map((x,i)=>x+b[i]); const scale=(a,k)=>a.map(x=>x*k);
  const basis=d=>{const ref=Math.abs(d[1])<.86?[0,1,0]:[1,0,0],u=norm(cross(d,ref)),v=norm(cross(d,u));return[u,v]};
  const around=(center,angle,az)=>{const [u,v]=basis(center);return norm(add(scale(center,Math.cos(angle)),add(scale(u,Math.sin(angle)*Math.cos(az)),scale(v,Math.sin(angle)*Math.sin(az)))))};
  const allowed=n=>!activeSet||activeSet.has(n.id);
  const kidsOf=n=>(n.children||[]).filter(allowed);
  const segment={...settings.length};
  const cone={class:deg(settings.angle.class),order:deg(settings.angle.order),family:deg(settings.angle.family),genus:deg(settings.angle.genus),species:deg(settings.angle.species)};
  const golden=2.399963229728653;
  const speciesCount=n=>{if(n.rank==='species')return 1;return kidsOf(n).reduce((a,c)=>a+speciesCount(c),0)};
  root.pos=[0,0,0]; root.dir=[0,0,1];
  const rootKids=kidsOf(root),phyla=rootKids.filter(n=>n.rank==='phylum');
  const phylumHalf=deg(Math.max(20,Math.min(178,settings.angle.phylum)))/2;
  if(phyla.length===1){phyla[0].dir=[0,0,1];phyla[0].pos=add(root.pos,scale(phyla[0].dir,segment.phylum))}
  else for(let i=0;i<phyla.length;i++){
    const p=phyla[i];
    if(p.name==='Basidiomycota')p.dir=norm([Math.sin(phylumHalf),.10,Math.cos(phylumHalf)]);
    else if(p.name==='Ascomycota')p.dir=norm([-Math.sin(phylumHalf),-.10,Math.cos(phylumHalf)]);
    else p.dir=around([0,0,1],phylumHalf,i*golden+(hash(p.id)%6283)/1000);
    p.pos=add(root.pos,scale(p.dir,segment.phylum));
  }
  for(const p of rootKids.filter(n=>n.rank!=='phylum')){p.dir=around([0,0,1],1.05,(hash(p.id)%6283)/1000);p.pos=add(root.pos,scale(p.dir,.68))}
  const placeChildren=parent=>{
    const kids=kidsOf(parent).slice().sort((a,b)=>a.name.localeCompare(b.name,'de')),n=kids.length;if(!n)return;
    for(let i=0;i<n;i++){
      const child=kids[i];if(child.rank==='phylum'&&parent===root){placeChildren(child);continue}
      const maxCone=cone[child.rank]??.18;let angle,az;
      if(n===1){angle=maxCone*.08;az=(hash(child.id)%6283)/1000}
      else if(n===2){angle=maxCone*.70;az=i*Math.PI+(hash(parent.id)%1000)/1000}
      else{const r=Math.sqrt((i+.72)/(n+.35));angle=maxCone*(.20+.80*r);az=i*golden+(hash(parent.id)%6283)/1000}
      child.dir=around(parent.dir,angle,az);
      const weight=Math.log2(1+speciesCount(child)),len=(segment[child.rank]??.34)*(1+Math.min(.16,weight*.018));
      child.pos=add(parent.pos,scale(child.dir,len));placeChildren(child);
    }
  };
  for(const p of rootKids)placeChildren(p);
}
function relayoutCurrentView(){
  if(subsetLayoutMode!=='subset'){layoutTree(visualSettings);return}
  const vis=visibleNodes(),active=new Set(vis.map(n=>n.id));layoutTree(subsetSettings,active);
}
function resetSubsetSettings(){subsetSettings=JSON.parse(JSON.stringify(visualSettings));initSubsetControls();relayoutCurrentView();render()}
function sortTree(n){n.children.sort((a,b)=>a.name.localeCompare(b.name,'de'));n.children.forEach(sortTree)}
function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function deg(v){return Number(v)*Math.PI/180}
function loadVisualSettings(){try{const x=JSON.parse(localStorage.getItem('pilzraum-visual-v5-4')||'null');if(x)return {length:{...VISUAL_DEFAULTS.length,...(x.length||{})},angle:{...VISUAL_DEFAULTS.angle,...(x.angle||{})},pathBrightness:Number(x.pathBrightness??VISUAL_DEFAULTS.pathBrightness),pathThickness:Number(x.pathThickness??VISUAL_DEFAULTS.pathThickness),speciesSize:Number(x.speciesSize??VISUAL_DEFAULTS.speciesSize)}}catch{}return JSON.parse(JSON.stringify(VISUAL_DEFAULTS))}
function saveVisualSettings(){localStorage.setItem('pilzraum-visual-v5-4',JSON.stringify(visualSettings))}
function rankIndex(r){return RANKS.indexOf(r)} function phylumOf(n){let p=n;while(p&&p.rank!=='phylum')p=p.parent;return p?.name||'other'}
function orderOf(n){let p=n;while(p&&p.rank!=='order')p=p.parent;return p?.name||null}
function classOf(n){let p=n;while(p&&p.rank!=='class')p=p.parent;return p?.name||null}
let CLASS_COLORS=new Map();
function assignClassColors(){
  const classes=nodes.filter(n=>n.rank==='class').sort((a,b)=>a.name.localeCompare(b.name,'de'));CLASS_COLORS=new Map();
  const palette=[.00,.055,.115,.17,.25,.34,.43,.51,.59,.67,.75,.83,.91,.965];
  classes.forEach((c,i)=>{const h=palette[i%palette.length],cycle=Math.floor(i/palette.length);CLASS_COLORS.set(c.name,hslToRgb((h+cycle*.035)%1,.84,.58))});
  renderClassLegend();
}
function hslToRgb(h,s,l){let r,g,b;if(s===0)r=g=b=l;else{const hue=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p},q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;r=hue(p,q,h+1/3);g=hue(p,q,h);b=hue(p,q,h-1/3)}return[r,g,b]}
function taxonColor(n){
  if(n.rank==='kingdom')return COLORS.root;
  const cls=classOf(n);if(cls&&CLASS_COLORS.has(cls))return CLASS_COLORS.get(cls);
  return COLORS[phylumOf(n)]||COLORS.other;
}
function renderClassLegend(){const el=$('#classLegend');if(!el)return;const classes=nodes.filter(n=>n.rank==='class').sort((a,b)=>a.name.localeCompare(b.name,'de'));el.innerHTML='';for(const c of classes.slice(0,10)){const rgb=CLASS_COLORS.get(c.name)||COLORS.other,d=document.createElement('span');d.className='class-chip';d.innerHTML=`<i style="background:rgb(${rgb.map(v=>Math.round(v*255)).join(',')})"></i>${esc(c.name)}`;el.appendChild(d)}if(classes.length>10){const d=document.createElement('span');d.className='class-chip more';d.textContent=`+${classes.length-10} Klassen`;el.appendChild(d)}}
function displayCommonName(n){return (n.common_name_de||'').trim()}
function pathOf(n){const a=[];let p=n;while(p){a.unshift(p.name);p=p.parent}return a.join(' › ')}
function initUI(){
  applyTheme(theme); $('#themeBtn').onclick=()=>{theme=theme==='dark'?'light':'dark';localStorage.setItem('pilzraum-theme',theme);applyTheme(theme);render()};
  const bar=$('#rankBar');RANKS.forEach(r=>{const b=document.createElement('button');b.textContent=RANK_DE[r];b.className=r===cutoff?'active':'';b.onclick=()=>{cutoff=r;$$('#rankBar button').forEach(x=>x.classList.toggle('active',x===b));if(subsetLayoutMode==='subset')relayoutCurrentView();render()};bar.appendChild(b)});
  $('#filterBtn').onclick=()=>$('#filterPanel').classList.toggle('hidden'); $('#visualBtn').onclick=()=>$('#visualPanel').classList.toggle('hidden'); $('#onlineSearchBtn').onclick=()=>openOnlineSearch($('#search').value); initTaxonomyFilters(); initVisualControls();
  $$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).classList.add('hidden'));
  $('#applyFilters').onclick=()=>{readFilters();$('#filterPanel').classList.add('hidden');relayoutCurrentView();render()}; $('#resetFilters').onclick=resetFilters;
  $('#search').addEventListener('input',doSearch); $('#search').addEventListener('keydown',e=>{if(e.key==='Escape')$('#searchResults').classList.add('hidden');if(e.key==='Enter'&&!e.shiftKey&&$('#searchResults').classList.contains('hidden'))openOnlineSearch(e.target.value)});
  $('#runOnlineSearch').onclick=()=>searchINat($('#onlineQuery').value); $('#onlineQuery').addEventListener('keydown',e=>{if(e.key==='Enter')searchINat(e.target.value)});
  $('#saveNode').onclick=saveSelected; $('#exportNode').onclick=exportSelected; $('#addFind').onclick=addFind; $('#geoBtn').onclick=useGeo; $('#ownPhotoInput').onchange=addOwnPhotos;
  $('#foundDate').value=todayISO(); $('#lightboxClose').onclick=closeLightbox; $('#lightbox').onclick=e=>{if(e.target.id==='lightbox')closeLightbox()}; readFilters();
}
function initVisualControls(){
  const lengthRanges={phylum:[.35,1.8,.05],class:[.35,1.8,.05],order:[.30,1.6,.05],family:[.20,1.3,.05],genus:[.15,1.0,.05],species:[.10,.75,.05]};
  const angleRanges={phylum:[30,178,1],class:[10,100,1],order:[8,80,1],family:[5,60,1],genus:[3,40,1],species:[2,25,1]};
  const labels={phylum:'Stamm',class:'Klasse',order:'Ordnung',family:'Familie',genus:'Gattung',species:'Art'};
  const make=(boxId,key,ranges,unit)=>{const box=$(boxId);box.innerHTML='';for(const rank of ['phylum','class','order','family','genus','species']){const [min,max,step]=ranges[rank],row=document.createElement('div');row.className='rank-slider-row';row.innerHTML=`<span>${labels[rank]}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${visualSettings[key][rank]}"><output>${fmtVisual(visualSettings[key][rank],unit)}</output>`;const inp=row.querySelector('input'),out=row.querySelector('output');inp.addEventListener('input',()=>{visualSettings[key][rank]=Number(inp.value);out.textContent=fmtVisual(inp.value,unit);saveVisualSettings();if(subsetLayoutMode==='global')rebuildLayout()});box.appendChild(row)}};
  make('#lengthControls','length',lengthRanges,'×');make('#angleControls','angle',angleRanges,'°');
  bindGlobalVisual('#pathBrightness','pathBrightness','#pathBrightnessOut',v=>Math.round(v*100)+' %',false);
  bindGlobalVisual('#pathThickness','pathThickness','#pathThicknessOut',v=>v+'×',false);
  bindGlobalVisual('#speciesSize','speciesSize','#speciesSizeOut',v=>v+' px',false);
  $('#resetVisuals').onclick=()=>{visualSettings=JSON.parse(JSON.stringify(VISUAL_DEFAULTS));saveVisualSettings();if(subsetLayoutMode==='subset')subsetSettings=JSON.parse(JSON.stringify(visualSettings));initVisualControls();initSubsetControls();rebuildLayout()};
  $('#closeVisuals').onclick=()=>$('#visualPanel').classList.add('hidden');
  $('#layoutGlobal').onchange=()=>setSubsetLayoutMode('global');
  $('#layoutSubset').onchange=()=>setSubsetLayoutMode('subset');
  $('#copyGlobalToSubset').onclick=resetSubsetSettings;
  initSubsetControls();
}
function initSubsetControls(){
  const box=$('#subsetControls');if(!box)return;
  $('#layoutGlobal').checked=subsetLayoutMode==='global';$('#layoutSubset').checked=subsetLayoutMode==='subset';
  box.classList.toggle('hidden',subsetLayoutMode!=='subset');
  const lengthRanges={phylum:[.35,2.2,.05],class:[.35,2.2,.05],order:[.30,2.0,.05],family:[.20,1.6,.05],genus:[.15,1.3,.05],species:[.10,1.0,.05]};
  const angleRanges={phylum:[30,178,1],class:[10,120,1],order:[8,100,1],family:[5,75,1],genus:[3,55,1],species:[2,35,1]};
  const labels={phylum:'Stamm',class:'Klasse',order:'Ordnung',family:'Familie',genus:'Gattung',species:'Art'};
  const make=(boxId,key,ranges,unit)=>{const host=$(boxId);if(!host)return;host.innerHTML='';for(const rank of ['phylum','class','order','family','genus','species']){const [min,max,step]=ranges[rank],row=document.createElement('div');row.className='rank-slider-row';row.innerHTML=`<span>${labels[rank]}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${subsetSettings[key][rank]}"><output>${fmtVisual(subsetSettings[key][rank],unit)}</output>`;const inp=row.querySelector('input'),out=row.querySelector('output');inp.oninput=()=>{subsetSettings[key][rank]=Number(inp.value);out.textContent=fmtVisual(inp.value,unit);relayoutCurrentView();render()};host.appendChild(row)}};
  make('#subsetLengthControls','length',lengthRanges,'×');make('#subsetAngleControls','angle',angleRanges,'°');
}
function setSubsetLayoutMode(mode){
  subsetLayoutMode=mode;if(mode==='subset')subsetSettings=JSON.parse(JSON.stringify(visualSettings));
  initSubsetControls();relayoutCurrentView();camera.zoom=mode==='subset'?4.35:5.15;render();
}
function fmtVisual(v,unit){return unit==='°'?Math.round(Number(v))+'°':Number(v).toFixed(2)+'×'}
function bindGlobalVisual(sel,key,outSel,fmt){const inp=$(sel),out=$(outSel);inp.value=visualSettings[key];out.textContent=fmt(visualSettings[key]);inp.oninput=()=>{visualSettings[key]=Number(inp.value);out.textContent=fmt(visualSettings[key]);saveVisualSettings();render()}}
let rebuildTimer=0;function rebuildLayout(){clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>{const selectedId=selected?.id||null;buildTree(raw);if(selectedId)selected=byId.get(selectedId)||null;if(subsetLayoutMode==='subset')relayoutCurrentView();render()},35)}
function applyTheme(t){document.documentElement.dataset.theme=t;const b=$('#themeBtn');if(b){b.textContent=t==='dark'?'☀':'☾';b.title=t==='dark'?'Hellmodus':'Dunkelmodus'}const meta=document.querySelector('meta[name=theme-color]');if(meta)meta.content=t==='dark'?'#11131a':'#f4f6fa'}
function taxonIsWithin(node,rank,id){if(!id)return true;let p=node;while(p){if(p.rank===rank)return p.id===String(id);p=p.parent}return false}
function taxFilterLabel(n){if(n.rank==='species'){const de=displayCommonName(n);return de?`${de} · ${n.name}`:n.name}return n.name}
function refreshTaxonomyFilterOptions(clearBelow=-1){
  const previous={};for(const rank of TAX_FILTER_RANKS)previous[rank]=$('#'+TAX_FILTER_IDS[rank])?.value||'';
  if(clearBelow>=0)for(let i=clearBelow+1;i<TAX_FILTER_RANKS.length;i++)previous[TAX_FILTER_RANKS[i]]='';
  const chosen={};
  TAX_FILTER_RANKS.forEach((rank,idx)=>{
    const sel=$('#'+TAX_FILTER_IDS[rank]);if(!sel)return;
    const candidates=nodes.filter(n=>n.rank===rank&&TAX_FILTER_RANKS.slice(0,idx).every(r=>!chosen[r]||taxonIsWithin(n,r,chosen[r]))).sort((a,b)=>taxFilterLabel(a).localeCompare(taxFilterLabel(b),'de'));
    const allLabel={phylum:'alle Stämme',class:'alle Klassen',order:'alle Ordnungen',family:'alle Familien',genus:'alle Gattungen',species:'alle Arten'}[rank];
    sel.innerHTML=`<option value="">${allLabel}</option>`+candidates.map(n=>`<option value="${escAttr(n.id)}">${esc(taxFilterLabel(n))}</option>`).join('');
    if(previous[rank]&&candidates.some(n=>n.id===previous[rank]))sel.value=previous[rank];else sel.value='';
    chosen[rank]=sel.value;
  })
}
function initTaxonomyFilters(){
  refreshTaxonomyFilterOptions();
  TAX_FILTER_RANKS.forEach((rank,idx)=>{const sel=$('#'+TAX_FILTER_IDS[rank]);if(!sel||sel.dataset.bound)return;sel.dataset.bound='1';sel.addEventListener('change',()=>refreshTaxonomyFilterOptions(idx))})
}
function resetFilters(){['phylumBasidio','phylumAsco','phylumOther'].forEach(id=>$('#'+id).checked=true);for(const rank of TAX_FILTER_RANKS){const el=$('#'+TAX_FILTER_IDS[rank]);if(el)el.value=''}refreshTaxonomyFilterOptions();$('#minObs').value=0;$('#entryState').value='all';$('#foundFrom').value='';$('#foundTo').value='';$('#onlyFound').checked=false;$('#onlyOwnPhotos').checked=false;$('#traitFilter').value='';readFilters();relayoutCurrentView();render()}
function readFilters(){const taxonomy={};for(const rank of TAX_FILTER_RANKS)taxonomy[rank]=$('#'+TAX_FILTER_IDS[rank])?.value||'';filters={min:+$('#minObs').value||0,basidio:$('#phylumBasidio').checked,asco:$('#phylumAsco').checked,other:$('#phylumOther').checked,entryState:$('#entryState').value,from:$('#foundFrom').value,to:$('#foundTo').value,onlyFound:$('#onlyFound').checked,photos:$('#onlyOwnPhotos').checked,text:$('#traitFilter').value.trim().toLowerCase(),taxonomy}}
function findMatchesDate(f){const d=(f.date||f.at||'').slice(0,10);if(!d)return false;if(filters.from&&d<filters.from)return false;if(filters.to&&d>filters.to)return false;return true}
function speciesPass(n){const p=phylumOf(n);if(p==='Basidiomycota'&&!filters.basidio)return false;if(p==='Ascomycota'&&!filters.asco)return false;if(p!=='Basidiomycota'&&p!=='Ascomycota'&&!filters.other)return false;for(const rank of TAX_FILTER_RANKS){const id=filters.taxonomy?.[rank];if(id&&!taxonIsWithin(n,rank,id))return false}if((n.obs_count||0)<filters.min)return false;const note=getNote(n.id),has=noteHasEntries(note);if(filters.entryState==='with'&&!has)return false;if(filters.entryState==='without'&&has)return false;if(filters.photos&&!(note?.photoCount>0))return false;if(filters.text&&!JSON.stringify(note||{}).toLowerCase().includes(filters.text))return false;const wantsFind=filters.onlyFound||filters.from||filters.to;if(wantsFind&&!((note?.finds||[]).some(findMatchesDate)))return false;return true}
function visibleNodes(){const max=RANKS.indexOf(cutoff),eligibleSpecies=new Set(nodes.filter(n=>n.rank==='species'&&speciesPass(n)).map(n=>n.id)),needed=new Set();for(const id of eligibleSpecies){let p=byId.get(id);while(p){needed.add(p.id);p=p.parent}}return nodes.filter(n=>{const ri=RANKS.indexOf(n.rank);if(ri<0||ri>max)return false;return needed.has(n.id)})}
function doSearch(){const q=$('#search').value.trim().toLowerCase(),box=$('#searchResults');if(!q){box.classList.add('hidden');return}const hits=nodes.filter(n=>n.name.toLowerCase().includes(q)||displayCommonName(n).toLowerCase().includes(q)).slice(0,30);box.innerHTML=hits.map(n=>{const cn=displayCommonName(n);return `<div class="search-result" data-id="${escAttr(n.id)}"><b>${esc(cn||n.name)}</b>${cn?` <i class="muted">${esc(n.name)}</i>`:''} <span class="muted">${RANK_DE[n.rank]||n.rank}</span>${n.added?' <span class="badge added">hinzugefügt</span>':''}<div class="path">${esc(pathOf(n))}</div></div>`}).join('')+`<div class="search-result" id="searchOnlineRow"><b>＋ iNaturalist online durchsuchen</b><div class="path">Falls die Art noch nicht lokal gespeichert ist</div></div>`;box.classList.remove('hidden');box.querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>{const n=byId.get(el.dataset.id);focusNode(n);openDetail(n);box.classList.add('hidden')});$('#searchOnlineRow').onclick=()=>{box.classList.add('hidden');openOnlineSearch($('#search').value)}}
function openOnlineSearch(q=''){if(!navigator.onLine){alert('Für das Hinzufügen einer neuen Art brauchst du kurz Internet. Bereits gespeicherte Arten funktionieren offline.');return}$('#onlinePanel').classList.remove('hidden');$('#onlineQuery').value=q||'';if((q||'').trim())searchINat(q)}
async function searchINat(q){q=(q||'').trim();if(!q)return;const state=$('#onlineState'),box=$('#onlineResults');state.textContent='Suche …';box.innerHTML='';try{const url=`${INAT.base}/taxa/autocomplete?q=${encodeURIComponent(q)}&rank=species&taxon_id=${INAT.fungiTaxonId}&per_page=12&locale=de&preferred_place_id=${INAT.placeId}`;const j=await fetchJSON(url);const res=(j.results||[]).filter(x=>x.rank==='species');state.textContent=res.length?`${res.length} Treffer`:'Keine Species-Treffer gefunden.';for(const t of res){const local=byId.has(String(t.id)),photo=t.default_photo?.square_url||t.default_photo?.medium_url||'';const d=document.createElement('div');d.className='online-result';d.innerHTML=`${photo?`<img src="${escAttr(photo)}" alt="">`:'<div></div>'}<div><b>${esc(t.name)}</b><div class="sub">${esc(t.preferred_common_name||'')} · ${local?'bereits lokal':'noch nicht im Baum'}</div></div><button ${local?'disabled':''} data-id="${t.id}" class="${local?'':'primary'}">${local?'Vorhanden':'Hinzufügen'}</button>`;const b=d.querySelector('button');if(!local)b.onclick=()=>addTaxonFromINat(t.id,b);box.appendChild(d)}}catch(e){state.textContent='Online-Suche fehlgeschlagen: '+e.message}}
async function addTaxonFromINat(id,button){button.disabled=true;button.textContent='Lade …';const state=$('#onlineState');try{const tj=await fetchJSON(`${INAT.base}/taxa/${id}?locale=de&preferred_place_id=${INAT.placeId}`),t=tj.results?.[0];if(!t)throw new Error('Taxon nicht gefunden');const lineage=[...(t.ancestors||[]),t].filter(x=>['kingdom','phylum','class','order','family','genus','species'].includes(x.rank));if(!lineage.some(x=>x.name==='Fungi'))throw new Error('Das Taxon gehört nicht zu Fungi.');const obs=await fetchJSON(`${INAT.base}/observations?place_id=${INAT.placeId}&taxon_id=${id}&photos=true&per_page=20&order_by=votes&order=desc`);const count=Number(obs.total_results||0),photoUrls=[];for(const o of (obs.results||[]))for(const p of (o.photos||[])){let u=p.url||'';if(u){u=u.replace('square','medium');if(!photoUrls.includes(u))photoUrls.push(u)}if(photoUrls.length>=4)break}const records=[];for(let i=0;i<lineage.length;i++){const x=lineage[i],isSp=x.rank==='species';records.push({id:String(x.id),parent_id:i?String(lineage[i-1].id):null,name:x.name,rank:x.rank,common_name_de:isSp?(x.preferred_common_name||null):null,obs_count:isSp?count:0,added:isSp,added_at:new Date().toISOString()})}await idbPutTaxa(records);let saved=0;for(const u of photoUrls.slice(0,4)){try{const r=await fetch(u);if(!r.ok)continue;const blob=await r.blob();await idbAddPhoto(String(id),new File([blob],`inat_${id}_${saved+1}.jpg`,{type:blob.type||'image/jpeg'}),'inat');saved++}catch{}}raw=mergeTaxa(raw,records);buildTree(raw);refreshTaxonomyFilterOptions();readFilters();if(subsetLayoutMode==='subset')relayoutCurrentView();render();state.textContent=`${t.name} hinzugefügt · ${count.toLocaleString('de-DE')} Schwarzwald-Beobachtungen · ${saved} Fotos offline gespeichert.`;button.textContent='Hinzugefügt';const n=byId.get(String(id));focusNode(n);openDetail(n)}catch(e){button.disabled=false;button.textContent='Erneut';state.textContent='Hinzufügen fehlgeschlagen: '+e.message}}
async function fetchJSON(url){const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}
function openDetail(n){selected=n;const note=getNote(n.id)||{};$('#detailName').innerHTML=`<span class="scientific">${esc(n.name)}</span>${displayCommonName(n)?`<span class="common-name">${esc(displayCommonName(n))}</span>`:''}`;$('#detailMeta').textContent=`${RANK_DE[n.rank]||n.rank} · ${(n.rank==='species'?n.obs_count:n.aggObs||0).toLocaleString('de-DE')} Beobachtungen · ${pathOf(n)}`;$('#detailBadges').innerHTML=`${n.added?'<span class="badge added">später hinzugefügt</span>':'<span class="badge">Basisdatensatz</span>'}<span class="badge offline">lokal verfügbar</span>`;const tf=$('#traitForm');tf.innerHTML='';(TRAITS[n.rank]||TRAITS.genus).forEach(k=>{const lab=document.createElement('label');lab.textContent=k;const inp=document.createElement('input');inp.dataset.trait=k;inp.value=note.traits?.[k]||'';lab.appendChild(inp);tf.appendChild(lab)});$('#freeNotes').value=note.freeNotes||'';$('#tags').value=(note.tags||[]).join(', ');$('#speciesSection').classList.toggle('hidden',n.rank!=='species');renderInatPhotos(n);renderFinds(note.finds||[]);renderOwnPhotos(n.id);$('#foundDate').value=todayISO();$('#detailPanel').classList.remove('hidden')}
async function renderInatPhotos(n){const box=$('#inatPhotos');box.innerHTML='';for(const src of (n.inat_photos||[]).slice(0,4)){const d=document.createElement('div');d.className='photo-card clickable';d.innerHTML=`<img loading="lazy" src="${escAttr(src)}" alt="iNaturalist-Foto von ${escAttr(n.name)}">`;d.querySelector('img').onclick=()=>openLightbox(src,n);box.appendChild(d)}const dyn=await idbGetPhotos(n.id,'inat');for(const p of dyn.slice(0,Math.max(0,4-box.children.length))){const d=document.createElement('div');d.className='photo-card clickable';const url=URL.createObjectURL(p.blob);d.innerHTML=`<img src="${url}" alt="iNaturalist-Foto von ${escAttr(n.name)}">`;d.querySelector('img').onclick=()=>openLightbox(url,n,true);box.appendChild(d)}if(!box.children.length)box.innerHTML='<div class="muted small">Keine Offline-iNaturalist-Fotos gespeichert.</div>'}
function openLightbox(src,n,isObjectUrl=false){const lb=$('#lightbox');$('#lightboxImg').src=src;$('#lightboxTitle').textContent=displayCommonName(n)?`${displayCommonName(n)} · ${n.name}`:n.name;lb.classList.remove('hidden');lb.dataset.objectUrl=isObjectUrl?'1':'0'}
function closeLightbox(){const img=$('#lightboxImg');if($('#lightbox').dataset.objectUrl==='1'&&img.src.startsWith('blob:'))URL.revokeObjectURL(img.src);img.src='';$('#lightbox').classList.add('hidden')}
async function saveSelected(){if(!selected)return;const prev=getNote(selected.id)||{},traits={};$$('#traitForm input').forEach(i=>traits[i.dataset.trait]=i.value);try{await setNote(selected.id,{...prev,traits,freeNotes:$('#freeNotes').value,tags:$('#tags').value.split(',').map(x=>x.trim()).filter(Boolean),updated_at:new Date().toISOString()});flash('Gespeichert · lokal auf diesem Gerät');render()}catch(e){console.error(e);alert('Speichern fehlgeschlagen: '+e.message)}}
async function addFind(){if(!selected)return;const date=$('#foundDate').value||todayISO(),lat=parseFloat($('#lat').value),lng=parseFloat($('#lng').value);if(!Number.isFinite(lat)||!Number.isFinite(lng))return alert('Bitte gültige Koordinaten eingeben.');const note=getNote(selected.id)||{};note.finds=[...(note.finds||[]),{lat,lng,date,at:new Date().toISOString()}];await setNote(selected.id,note);renderFinds(note.finds);$('#lat').value='';$('#lng').value='';render()}
function renderFinds(finds){const box=$('#findList');box.innerHTML='';finds.forEach((f,i)=>{const d=document.createElement('div');d.className='find-item';const date=(f.date||f.at||'').slice(0,10)||'ohne Datum';d.innerHTML=`<div class="find-main"><span class="find-date">${esc(date)}</span><span>${Number(f.lat).toFixed(5)}, ${Number(f.lng).toFixed(5)}</span></div><button data-i="${i}">löschen</button>`;d.querySelector('button').onclick=()=>{const n=getNote(selected.id)||{};n.finds.splice(i,1);setNote(selected.id,n);renderFinds(n.finds);render()};box.appendChild(d)})}
function useGeo(){if(!navigator.geolocation)return alert('GPS ist in diesem Browser nicht verfügbar.');navigator.geolocation.getCurrentPosition(p=>{$('#lat').value=p.coords.latitude.toFixed(6);$('#lng').value=p.coords.longitude.toFixed(6)},()=>alert('Standort konnte nicht gelesen werden. Du kannst die Koordinaten auch manuell eintragen.'),{enableHighAccuracy:true,timeout:10000})}
async function addOwnPhotos(e){if(!selected)return;for(const file of [...e.target.files])await idbAddPhoto(selected.id,file,'own');const note=getNote(selected.id)||{};note.photoCount=await idbPhotoCount(selected.id,'own');await setNote(selected.id,note);await renderOwnPhotos(selected.id);e.target.value='';render()}
async function renderOwnPhotos(taxonId){const box=$('#ownPhotos');box.innerHTML='';const photos=await idbGetPhotos(taxonId,'own');for(const p of photos){const d=document.createElement('div');d.className='photo-card clickable';const url=URL.createObjectURL(p.blob);d.innerHTML=`<img src="${url}" alt="eigenes Pilzfoto"><button>×</button>`;d.querySelector('img').onclick=()=>openLightbox(url,selected,true);d.querySelector('button').onclick=async e=>{e.stopPropagation();URL.revokeObjectURL(url);await idbDeletePhoto(p.id);const n=getNote(taxonId)||{};n.photoCount=await idbPhotoCount(taxonId,'own');await setNote(taxonId,n);await renderOwnPhotos(taxonId);render()};box.appendChild(d)}}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('pilzraum-db',3);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('photos')){const st=db.createObjectStore('photos',{keyPath:'id',autoIncrement:true});st.createIndex('taxonId','taxonId',{unique:false})}if(!db.objectStoreNames.contains('taxa'))db.createObjectStore('taxa',{keyPath:'id'});if(!db.objectStoreNames.contains('notes'))db.createObjectStore('notes',{keyPath:'taxonId'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function idbPutTaxa(arr){const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('taxa','readwrite'),st=tx.objectStore('taxa');arr.forEach(x=>st.put({...x,id:String(x.id),parent_id:x.parent_id==null?null:String(x.parent_id)}));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function idbGetAddedTaxa(){const db=await dbPromise;return new Promise((resolve,reject)=>{const r=db.transaction('taxa').objectStore('taxa').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)})}
async function idbAddPhoto(taxonId,file,source='own'){const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('photos','readwrite');tx.objectStore('photos').add({taxonId:String(taxonId),source,name:file.name,type:file.type,blob:file,created_at:new Date().toISOString()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function idbGetPhotos(taxonId,source='own'){const db=await dbPromise;return new Promise((resolve,reject)=>{const r=db.transaction('photos').objectStore('photos').index('taxonId').getAll(String(taxonId));r.onsuccess=()=>resolve((r.result||[]).filter(p=>source==='own'?(p.source||'own')==='own':p.source===source));r.onerror=()=>reject(r.error)})}
async function idbDeletePhoto(id){const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('photos','readwrite');tx.objectStore('photos').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function idbPhotoCount(taxonId,source='own'){return (await idbGetPhotos(taxonId,source)).length}
function exportSelected(){if(!selected)return;const blob=new Blob([JSON.stringify({taxon:selected,user_data:getNote(selected.id)||{}},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`pilzraum_${selected.name.replace(/\s+/g,'_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
async function loadNoteCache(){const db=await dbPromise;const all=await new Promise((resolve,reject)=>{const r=db.transaction('notes').objectStore('notes').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)});noteCache=new Map(all.map(x=>[String(x.taxonId),x.value]));const migrate=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(!k||!k.startsWith('pilzraum:'))continue;const id=k.slice(9);if(noteCache.has(id))continue;try{const v=JSON.parse(localStorage.getItem(k)||'null');if(v){noteCache.set(id,v);migrate.push([id,v])}}catch{}}for(const [id,v] of migrate)await setNote(id,v)}
function getNote(id){return noteCache.get(String(id))||null}
function noteHasEntries(note){
  if(!note)return false;
  if(note.freeNotes&&String(note.freeNotes).trim())return true;
  if(Array.isArray(note.tags)&&note.tags.some(x=>String(x||'').trim()))return true;
  if(Array.isArray(note.finds)&&note.finds.length>0)return true;
  if((Number(note.photoCount)||0)>0)return true;
  if(note.traits&&Object.values(note.traits).some(v=>String(v??'').trim()))return true;
  return false;
}
async function setNote(id,v){id=String(id);noteCache.set(id,v);try{localStorage.setItem('pilzraum:'+id,JSON.stringify(v))}catch{}const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('notes','readwrite');tx.objectStore('notes').put({taxonId:id,value:v,updated_at:new Date().toISOString()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
function todayISO(){return new Date().toLocaleDateString('sv-SE')} function flash(s){$('#status').textContent=s;setTimeout(()=>render(),1600)}

// Minimaler WebGL-Renderer, absichtlich ohne externe Online-Bibliothek.
function initGL(){
  const c=$('#treeCanvas');gl=c.getContext('webgl',{antialias:true,alpha:false});if(!gl){alert('WebGL wird auf diesem Gerät nicht unterstützt.');return}
  const vs=`attribute vec3 p;attribute vec3 col;attribute float sz;uniform mat4 mvp;uniform float sizeMul;varying vec3 vcol;void main(){gl_Position=mvp*vec4(p,1.0);gl_PointSize=(sz*sizeMul)/max(.30,gl_Position.w);vcol=col;}`,
        fs=`precision mediump float;varying vec3 vcol;uniform float points;uniform float alpha;uniform float glow;void main(){if(points>.5){vec2 q=gl_PointCoord-.5;float r=length(q);if(r>.5)discard;if(glow>.5){float a=pow(max(0.,1.-r*2.),2.2)*alpha;gl_FragColor=vec4(vcol,a);}else{float rim=smoothstep(.50,.12,r);float core=.62+.48*pow(max(0.,1.-r*2.),1.7);gl_FragColor=vec4(min(vec3(1.),vcol*core+vec3(.12)*rim),alpha);}}else gl_FragColor=vec4(vcol,alpha);}`;
  prog=mkProg(vs,fs);loc={p:gl.getAttribLocation(prog,'p'),col:gl.getAttribLocation(prog,'col'),sz:gl.getAttribLocation(prog,'sz'),mvp:gl.getUniformLocation(prog,'mvp'),points:gl.getUniformLocation(prog,'points'),alpha:gl.getUniformLocation(prog,'alpha'),glow:gl.getUniformLocation(prog,'glow'),sizeMul:gl.getUniformLocation(prog,'sizeMul')};bufLines=gl.createBuffer();bufPoints=gl.createBuffer();
  c.addEventListener('pointerdown',e=>{pointer={down:true,x:e.clientX,y:e.clientY,moved:false};c.setPointerCapture(e.pointerId)});
  c.addEventListener('pointermove',e=>{if(pointer.down){const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.abs(dx)+Math.abs(dy)>2)pointer.moved=true;camera.yaw+=dx*.008;camera.pitch=Math.max(-1.45,Math.min(1.45,camera.pitch+dy*.008));pointer.x=e.clientX;pointer.y=e.clientY;hoverNode=null;render();return}if(e.pointerType==='mouse'){const h=pickNearest(e.clientX,e.clientY,18);if(h!==hoverNode){hoverNode=h;renderLabels(visibleNodes())}}});
  c.addEventListener('pointerleave',()=>{if(hoverNode){hoverNode=null;renderLabels(visibleNodes())}});
  c.addEventListener('pointerup',e=>{pointer.down=false;if(!pointer.moved){const n=pickNearest(e.clientX,e.clientY,26);if(n){hoverNode=n;openDetail(n);renderLabels(visibleNodes())}}});
  c.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=Math.max(1.45,Math.min(8,camera.zoom*Math.exp(e.deltaY*.001)));render()},{passive:false});
  let lastDist=0;c.addEventListener('touchmove',e=>{if(e.touches.length===2){const a=e.touches[0],b=e.touches[1],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);if(lastDist)camera.zoom=Math.max(1.45,Math.min(8,camera.zoom*(lastDist/d)));lastDist=d;render()}},{passive:false});c.addEventListener('touchend',()=>lastDist=0)
}
function mkProg(vs,fs){const sh=(t,s)=>{const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);return x},p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,vs));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);return p}
function resize(){const c=$('#treeCanvas'),l=$('#labelCanvas'),d=devicePixelRatio||1;c.width=Math.round(c.clientWidth*d);c.height=Math.round(c.clientHeight*d);l.width=c.width;l.height=c.height;gl&&gl.viewport(0,0,c.width,c.height)}
function render(){
  if(!gl)return;const vis=visibleNodes(),set=new Set(vis),speciesAll=nodes.filter(n=>n.rank==='species'&&(n.obs_count||0)>0),maxObs=Math.max(1,...speciesAll.map(n=>n.obs_count||0)),minObs=Math.min(maxObs,...speciesAll.map(n=>n.obs_count||0)),line=[],pts=[];
  for(const n of vis){
    if(n.parent&&set.has(n.parent)){const cc=branchColor(n);line.push(...n.parent.pos,...cc,1,...n.pos,...cc,1)}
    const c=nodeColor(n,minObs,maxObs),size=n.rank==='species'?visualSettings.speciesSize:(n.rank==='kingdom'?22:n.rank==='phylum'?18:n.rank==='class'?16:12);pts.push(...n.pos,...c,size)
  }
  const bg=theme==='dark'?[.025,.032,.05,1]:[.965,.974,.988,1];gl.clearColor(...bg);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.useProgram(prog);gl.uniformMatrix4fv(loc.mvp,false,getMVP());
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1f(loc.alpha,Math.max(.05,Math.min(1,visualSettings.pathBrightness)));gl.uniform1f(loc.glow,0);gl.uniform1f(loc.sizeMul,1);gl.lineWidth(Math.max(1,visualSettings.pathThickness));drawThickLines(line,visualSettings.pathThickness);
  // weicher Halo wie in der Zielabbildung
  gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.depthMask(false);gl.uniform1f(loc.alpha,theme==='dark'?.20:.10);gl.uniform1f(loc.glow,1);gl.uniform1f(loc.sizeMul,2.7);draw(pts,gl.POINTS,true);
  gl.depthMask(true);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.uniform1f(loc.alpha,1);gl.uniform1f(loc.glow,0);gl.uniform1f(loc.sizeMul,1);draw(pts,gl.POINTS,true);gl.disable(gl.BLEND);
  renderLabels(vis);const species=vis.filter(n=>n.rank==='species').length;$('#status').textContent=`${species.toLocaleString('de-DE')} Arten sichtbar · ${vis.length.toLocaleString('de-DE')} Nodes · ${RANK_DE[cutoff]} · ${subsetLayoutMode==='subset'?'Subset aufgespannt':'Gesamtbaum-Positionen'}`
}
function obsNorm(v,minObs,maxObs){if(maxObs<=minObs)return 1;const lo=Math.log1p(Math.max(0,minObs)),hi=Math.log1p(Math.max(1,maxObs));return Math.max(0,Math.min(1,(Math.log1p(Math.max(0,v))-lo)/(hi-lo)))}
function branchColor(n){const b=taxonColor(n);return theme==='dark'?b.map(v=>.04+v*.34):b.map(v=>.32+v*.38)}
function nodeColor(n,minObs,maxObs){
  const b=taxonColor(n);if(n.rank!=='species')return theme==='dark'?b.map(v=>Math.min(1,.24+v*.78)):b.map(v=>.16+v*.68);
  // Alle Arten gleich groß; ausschließlich die Helligkeit kodiert Häufigkeit.
  const t=Math.pow(obsNorm(n.obs_count||0,minObs,maxObs),.72),low=theme==='dark'?.16:.34,span=theme==='dark'?1.02:.64;
  let out=b.map(v=>Math.min(1,low+v*(.16+span*t)));if(n.added)out=out.map(v=>Math.min(1,v+.07));return out
}
function renderLabels(vis){
  const c=$('#labelCanvas'),ctx=c.getContext('2d'),rect=$('#treeCanvas').getBoundingClientRect(),d=devicePixelRatio||1;if(c.width!==Math.round(rect.width*d)||c.height!==Math.round(rect.height*d)){c.width=Math.round(rect.width*d);c.height=Math.round(rect.height*d)}ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,rect.width,rect.height);const m=getMVP();
  // Dauerhaft bleiben nur die drei räumlichen Anker sichtbar. Alle übrigen Namen erscheinen
  // erst beim Hover (Desktop) bzw. Antippen (Touch), damit der Baum selbst lesbar bleibt.
  const anchors=vis.filter(n=>n.rank==='kingdom'||n.rank==='phylum');for(const n of anchors)drawTinyLabel(ctx,n,project(n.pos,m,rect.width,rect.height),rect);
  const n=hoverNode||selected;if(!n||!vis.includes(n))return;const q=project(n.pos,m,rect.width,rect.height);if(q[2]<-1||q[2]>1)return;drawTooltip(ctx,n,q,rect)
}
function drawTinyLabel(ctx,n,q,rect){if(q[0]<0||q[0]>rect.width||q[1]<0||q[1]>rect.height)return;ctx.font='600 11px system-ui';const txt=n.name,w=ctx.measureText(txt).width+12,x=q[0]+10,y=q[1]-10;ctx.fillStyle=theme==='dark'?'rgba(7,10,16,.70)':'rgba(255,255,255,.82)';ctx.fillRect(x,y,w,20);ctx.fillStyle=theme==='dark'?'#eef1f8':'#18202c';ctx.fillText(txt,x+6,y+14)}
function drawTooltip(ctx,n,q,rect){
  const common=displayCommonName(n),title=common||n.name,scientific=n.rank==='species'&&common?n.name:'',meta=n.rank==='species'?`${RANK_DE[n.rank]} · ${(n.obs_count||0).toLocaleString('de-DE')} Beobachtungen`:(RANK_DE[n.rank]||n.rank);
  ctx.font='700 13px system-ui';const w=Math.max(170,ctx.measureText(title).width+24,scientific?ctx.measureText(scientific).width+24:0,ctx.measureText(meta).width+24),h=scientific?63:47;let x=q[0]+18,y=q[1]-h-10;if(x+w>rect.width-8)x=q[0]-w-18;if(y<8)y=q[1]+14;
  ctx.fillStyle=theme==='dark'?'rgba(8,12,20,.94)':'rgba(255,255,255,.96)';ctx.strokeStyle=theme==='dark'?'rgba(170,185,210,.28)':'rgba(50,70,95,.20)';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x,y,w,h,9);ctx.fill();ctx.stroke();
  ctx.fillStyle=theme==='dark'?'#f4f7fb':'#152033';ctx.fillText(title,x+12,y+19);let yy=y+36;if(scientific){ctx.font='italic 11px system-ui';ctx.fillStyle=theme==='dark'?'#b9c2d3':'#647084';ctx.fillText(scientific,x+12,yy);yy+=17}ctx.font='11px system-ui';ctx.fillStyle=theme==='dark'?'#9faabd':'#687386';ctx.fillText(meta,x+12,yy)
}
function drawThickLines(arr,thickness){
  draw(arr,gl.LINES,false);
  // WebGL unter Windows begrenzt gl.lineWidth oft auf 1px. Zusätzliche leicht versetzte
  // Linien-Pässe machen den Regler deshalb auch dort sichtbar wirksam.
  const passes=Math.max(0,Math.round(thickness)-1);if(!passes)return;
  for(let k=1;k<=passes;k++){const eps=.0018*Math.ceil(k/2)*(k%2?1:-1),copy=arr.slice();for(let i=0;i<copy.length;i+=7){copy[i]+=eps;copy[i+1]-=eps*.6}draw(copy,gl.LINES,false)}
}
function draw(arr,mode,points){if(!arr.length)return;const stride=7,data=new Float32Array(arr),buf=points?bufPoints:bufLines;gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(loc.p);gl.vertexAttribPointer(loc.p,3,gl.FLOAT,false,stride*4,0);gl.enableVertexAttribArray(loc.col);gl.vertexAttribPointer(loc.col,3,gl.FLOAT,false,stride*4,12);gl.enableVertexAttribArray(loc.sz);gl.vertexAttribPointer(loc.sz,1,gl.FLOAT,false,stride*4,24);gl.uniform1f(loc.points,points?1:0);gl.drawArrays(mode,0,data.length/stride)}
function getMVP(){const a=$('#treeCanvas').width/Math.max(1,$('#treeCanvas').height),p=persp(.85,a,.1,20),v=mul(trans(0,0,-camera.zoom),mul(rotX(camera.pitch),rotY(camera.yaw)));return mul(p,v)}
function pickNearest(x,y,maxDist=22){const vis=visibleNodes(),rect=$('#treeCanvas').getBoundingClientRect(),m=getMVP();let best=null,bd=maxDist;for(const n of vis){const q=project(n.pos,m,rect.width,rect.height);if(q[2]<-1||q[2]>1)continue;const d=Math.hypot(q[0]-(x-rect.left),q[1]-(y-rect.top));if(d<bd){bd=d;best=n}}return best}function pick(x,y){const best=pickNearest(x,y,24);if(best)openDetail(best)}
function focusNode(n){const p=n.pos,yaw=Math.atan2(p[0],p[2]),pitch=-Math.asin(p[1]/(Math.hypot(...p)||1));camera.yaw=-yaw;camera.pitch=pitch;camera.zoom=2.75;render()}
function project(v,m,w,h){const q=mv(m,[...v,1]);return[(q[0]/q[3]*.5+.5)*w,(1-(q[1]/q[3]*.5+.5))*h,q[2]/q[3]]}function mv(m,v){return[0,1,2,3].map(r=>m[r]*v[0]+m[4+r]*v[1]+m[8+r]*v[2]+m[12+r]*v[3])}function mul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o}function persp(f,a,n,fa){const t=1/Math.tan(f/2),o=new Float32Array(16);o[0]=t/a;o[5]=t;o[10]=(fa+n)/(n-fa);o[11]=-1;o[14]=2*fa*n/(n-fa);return o}function trans(x,y,z){const o=ident();o[12]=x;o[13]=y;o[14]=z;return o}function rotX(a){const o=ident(),c=Math.cos(a),s=Math.sin(a);o[5]=c;o[6]=s;o[9]=-s;o[10]=c;return o}function rotY(a){const o=ident(),c=Math.cos(a),s=Math.sin(a);o[0]=c;o[2]=-s;o[8]=s;o[10]=c;return o}function ident(){const o=new Float32Array(16);o[0]=o[5]=o[10]=o[15]=1;return o}
function esc(s){return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}function escAttr(s){return esc(s).replace(/"/g,'&quot;')}
init().catch(e=>{console.error(e);document.body.innerHTML='<pre style="padding:20px">App konnte nicht geladen werden:\n'+esc(e.message)+'</pre>'});

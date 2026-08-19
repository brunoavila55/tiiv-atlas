import {useEffect,useState} from 'react';
import {Cpu,Layers,Network,Plug,Plus} from 'lucide-react';
import {api,type Device} from './lib/api';
import {RowMenu} from './RowMenu';
import {Modal} from './ResourcePages';

// ---------- Manufacturers ----------
type Manufacturer={id:string;name:string;website?:string};
const emptyManufacturer={name:'',website:''};
export function ManufacturersPage(){
  const [items,setItems]=useState<Manufacturer[]>([]),[open,setOpen]=useState(false),[editing,setEditing]=useState<Manufacturer|null>(null),[error,setError]=useState('');
  const [form,setForm]=useState(emptyManufacturer);
  const load=()=>api<Manufacturer[]>('/manufacturers?page_size=100').then(setItems).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);
  const startCreate=()=>{setEditing(null);setForm(emptyManufacturer);setError('');setOpen(true)};
  const startEdit=(m:Manufacturer)=>{setEditing(m);setForm({name:m.name,website:m.website||''});setError('');setOpen(true)};
  const save=async()=>{try{const body=editing?form:Object.fromEntries(Object.entries(form).filter(([,v])=>v!==''));if(editing)await api(`/manufacturers/${editing.id}`,{method:'PUT',body:JSON.stringify(body)});else await api('/manufacturers',{method:'POST',body:JSON.stringify(body)});setOpen(false);load()}catch(e){setError(e instanceof Error?e.message:'Could not save manufacturer')}};
  const remove=async(m:Manufacturer)=>{if(!confirm(`Delete ${m.name}? Device models from this manufacturer must be removed first.`))return;try{await api(`/manufacturers/${m.id}`,{method:'DELETE'});load()}catch(e){setError(e instanceof Error?e.message:'Could not delete manufacturer — it may still have device models')}};
  return <><div className="page-head"><div><h1>Manufacturers</h1><p>Vendors and brands behind your device models.</p></div><button className="primary" onClick={startCreate}><Plus size={16}/>Add manufacturer</button></div>
    {error&&!open&&<div className="form-error page-error">{error}</div>}
    <section className="panel">{items.length===0?<div className="resource-empty"><Cpu/><h2>No manufacturers yet</h2><p>Add the vendors whose equipment you track.</p><button className="primary" onClick={startCreate}><Plus size={15}/>Add manufacturer</button></div>:<div className="table-wrap"><table><thead><tr><th>Manufacturer</th><th>Website</th><th/></tr></thead><tbody>{items.map(m=><tr key={m.id}><td><span className="resource-name"><Cpu/><strong>{m.name}</strong></span></td><td>{m.website?<a href={m.website} target="_blank" rel="noreferrer">{m.website}</a>:'—'}</td><td><RowMenu items={[{label:'Edit manufacturer',onClick:()=>startEdit(m)},{label:'Delete manufacturer',danger:true,onClick:()=>void remove(m)}]}/></td></tr>)}</tbody></table></div>}</section>
    {open&&<Modal title={editing?'Edit manufacturer':'Add manufacturer'} close={()=>setOpen(false)} save={save} error={error} saveLabel={editing?'Save changes':'Save'}><label>Name<input autoFocus value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Dell, Cisco, APC..."/></label><label>Website (optional)<input value={form.website} onChange={e=>setForm(f=>({...f,website:e.target.value}))} placeholder="https://example.com"/></label></Modal>}
  </>;
}

// ---------- Device Models ----------
type DeviceModel={id:string;manufacturer_id:string;name:string;height_u:number;default_port_count?:number;description?:string};
const emptyDeviceModel={manufacturer_id:'',name:'',height_u:'1',default_port_count:'',description:''};
export function DeviceModelsPage(){
  const [items,setItems]=useState<DeviceModel[]>([]),[manufacturers,setManufacturers]=useState<Manufacturer[]>([]),[open,setOpen]=useState(false),[editing,setEditing]=useState<DeviceModel|null>(null),[error,setError]=useState('');
  const [form,setForm]=useState(emptyDeviceModel);
  const load=()=>Promise.all([api<DeviceModel[]>('/device-models?page_size=100'),api<Manufacturer[]>('/manufacturers?page_size=100')]).then(([d,m])=>{setItems(d);setManufacturers(m);setForm(f=>({...f,manufacturer_id:f.manufacturer_id||m[0]?.id||''}))}).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);
  const startCreate=()=>{setEditing(null);setForm(()=>({...emptyDeviceModel,manufacturer_id:manufacturers[0]?.id||''}));setError('');setOpen(true)};
  const startEdit=(d:DeviceModel)=>{setEditing(d);setForm({manufacturer_id:d.manufacturer_id,name:d.name,height_u:String(d.height_u),default_port_count:d.default_port_count?String(d.default_port_count):'',description:d.description||''});setError('');setOpen(true)};
  const save=async()=>{try{const body:Record<string,unknown>={manufacturer_id:form.manufacturer_id,name:form.name,height_u:Number(form.height_u)||1};if(editing){body.default_port_count=form.default_port_count?Number(form.default_port_count):null;body.description=form.description}else{if(form.default_port_count)body.default_port_count=Number(form.default_port_count);if(form.description)body.description=form.description}if(editing)await api(`/device-models/${editing.id}`,{method:'PUT',body:JSON.stringify(body)});else await api('/device-models',{method:'POST',body:JSON.stringify(body)});setOpen(false);load()}catch(e){setError(e instanceof Error?e.message:'Could not save device model')}};
  const remove=async(d:DeviceModel)=>{if(!confirm(`Delete ${d.name}?`))return;try{await api(`/device-models/${d.id}`,{method:'DELETE'});load()}catch(e){setError(e instanceof Error?e.message:'Could not delete device model — it may still be assigned to devices')}};
  return <><div className="page-head"><div><h1>Device Models</h1><p>Reusable hardware templates from each manufacturer.</p></div><button className="primary" onClick={startCreate}><Plus size={16}/>Add device model</button></div>
    {error&&!open&&<div className="form-error page-error">{error}</div>}
    <section className="panel">{items.length===0?<div className="resource-empty"><Layers/><h2>No device models yet</h2><p>Register the hardware templates you deploy.</p><button className="primary" onClick={startCreate}><Plus size={15}/>Add device model</button></div>:<div className="table-wrap"><table><thead><tr><th>Model</th><th>Manufacturer</th><th>Height (U)</th><th>Default ports</th><th/></tr></thead><tbody>{items.map(d=><tr key={d.id}><td><span className="resource-name"><Layers/><strong>{d.name}</strong></span></td><td>{manufacturers.find(m=>m.id===d.manufacturer_id)?.name??'—'}</td><td>{d.height_u}U</td><td>{d.default_port_count??'—'}</td><td><RowMenu items={[{label:'Edit model',onClick:()=>startEdit(d)},{label:'Delete model',danger:true,onClick:()=>void remove(d)}]}/></td></tr>)}</tbody></table></div>}</section>
    {open&&<Modal title={editing?'Edit device model':'Add device model'} close={()=>setOpen(false)} save={save} error={error} saveLabel={editing?'Save changes':'Save'}><label>Manufacturer<select value={form.manufacturer_id} onChange={e=>setForm(f=>({...f,manufacturer_id:e.target.value}))}>{manufacturers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Model name<input autoFocus value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="PowerEdge R740"/></label><div className="form-row"><label>Height (U)<input type="number" min="1" value={form.height_u} onChange={e=>setForm(f=>({...f,height_u:e.target.value}))}/></label><label>Default ports (optional)<input type="number" min="0" value={form.default_port_count} onChange={e=>setForm(f=>({...f,default_port_count:e.target.value}))}/></label></div><label>Description (optional)<textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></label></Modal>}
  </>;
}

// ---------- VLANs ----------
type Site={id:string;name:string};
type Vlan={id:string;site_id?:string;vid:number;name:string;description?:string};
const emptyVlan={site_id:'',vid:'',name:'',description:''};
export function VlansPage(){
  const [items,setItems]=useState<Vlan[]>([]),[sites,setSites]=useState<Site[]>([]),[open,setOpen]=useState(false),[editing,setEditing]=useState<Vlan|null>(null),[error,setError]=useState('');
  const [form,setForm]=useState(emptyVlan);
  const load=()=>Promise.all([api<Vlan[]>('/vlans?page_size=100'),api<Site[]>('/sites?page_size=100')]).then(([v,s])=>{setItems(v);setSites(s);setForm(f=>({...f,site_id:f.site_id||s[0]?.id||''}))}).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);
  const startCreate=()=>{setEditing(null);setForm(()=>({...emptyVlan,site_id:sites[0]?.id||''}));setError('');setOpen(true)};
  const startEdit=(v:Vlan)=>{setEditing(v);setForm({site_id:v.site_id||'',vid:String(v.vid),name:v.name,description:v.description||''});setError('');setOpen(true)};
  const save=async()=>{try{const body:Record<string,unknown>={vid:Number(form.vid),name:form.name};if(editing){body.site_id=form.site_id||null;body.description=form.description}else{if(form.site_id)body.site_id=form.site_id;if(form.description)body.description=form.description}if(editing)await api(`/vlans/${editing.id}`,{method:'PUT',body:JSON.stringify(body)});else await api('/vlans',{method:'POST',body:JSON.stringify(body)});setOpen(false);load()}catch(e){setError(e instanceof Error?e.message:'Could not save VLAN')}};
  const remove=async(v:Vlan)=>{if(!confirm(`Delete VLAN ${v.vid} (${v.name})?`))return;try{await api(`/vlans/${v.id}`,{method:'DELETE'});load()}catch(e){setError(e instanceof Error?e.message:'Could not delete VLAN — it may still be assigned to ports')}};
  return <><div className="page-head"><div><h1>VLANs</h1><p>Logical network segments per site.</p></div><button className="primary" onClick={startCreate}><Plus size={16}/>Add VLAN</button></div>
    {error&&!open&&<div className="form-error page-error">{error}</div>}
    <section className="panel">{items.length===0?<div className="resource-empty"><Network/><h2>No VLANs yet</h2><p>Define the logical segments used across your sites.</p><button className="primary" onClick={startCreate}><Plus size={15}/>Add VLAN</button></div>:<div className="table-wrap"><table><thead><tr><th>VID</th><th>Name</th><th>Site</th><th>Description</th><th/></tr></thead><tbody>{items.map(v=><tr key={v.id}><td className="mono">{v.vid}</td><td><span className="resource-name"><Network/><strong>{v.name}</strong></span></td><td>{sites.find(s=>s.id===v.site_id)?.name??'—'}</td><td>{v.description||'—'}</td><td><RowMenu items={[{label:'Edit VLAN',onClick:()=>startEdit(v)},{label:'Delete VLAN',danger:true,onClick:()=>void remove(v)}]}/></td></tr>)}</tbody></table></div>}</section>
    {open&&<Modal title={editing?'Edit VLAN':'Add VLAN'} close={()=>setOpen(false)} save={save} error={error} saveLabel={editing?'Save changes':'Save'}><label>Site (optional)<select value={form.site_id} onChange={e=>setForm(f=>({...f,site_id:e.target.value}))}><option value="">— none —</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>VLAN ID<input autoFocus type="number" min="1" max="4094" value={form.vid} onChange={e=>setForm(f=>({...f,vid:e.target.value}))} placeholder="10"/></label><label>Name<input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Servers"/></label><label>Description (optional)<textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></label></Modal>}
  </>;
}

// ---------- Ports ----------
type Port={id:string;device_id:string;name:string;type:string;description?:string;speed?:string;enabled:boolean};
const PORT_TYPES=['ethernet','fiber','sfp','sfp_plus','qsfp','console','power','wireless','other'];
const emptyPort={device_id:'',name:'',type:'ethernet',description:'',speed:'',enabled:true};
export function PortsPage(){
  const [items,setItems]=useState<Port[]>([]),[devices,setDevices]=useState<Device[]>([]),[open,setOpen]=useState(false),[editing,setEditing]=useState<Port|null>(null),[error,setError]=useState('');
  const [form,setForm]=useState(emptyPort);
  const load=()=>Promise.all([api<Port[]>('/ports?page_size=100'),api<Device[]>('/devices?page_size=100')]).then(([p,d])=>{setItems(p);setDevices(d);setForm(f=>({...f,device_id:f.device_id||d[0]?.id||''}))}).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);
  const startCreate=()=>{setEditing(null);setForm(()=>({...emptyPort,device_id:devices[0]?.id||''}));setError('');setOpen(true)};
  const startEdit=(p:Port)=>{setEditing(p);setForm({device_id:p.device_id,name:p.name,type:p.type,description:p.description||'',speed:p.speed||'',enabled:p.enabled});setError('');setOpen(true)};
  const save=async()=>{try{const body:Record<string,unknown>={device_id:form.device_id,name:form.name,type:form.type,enabled:form.enabled};if(editing){body.description=form.description;body.speed=form.speed}else{if(form.description)body.description=form.description;if(form.speed)body.speed=form.speed}if(editing)await api(`/ports/${editing.id}`,{method:'PUT',body:JSON.stringify(body)});else await api('/ports',{method:'POST',body:JSON.stringify(body)});setOpen(false);load()}catch(e){setError(e instanceof Error?e.message:'Could not save port')}};
  const remove=async(p:Port)=>{if(!confirm(`Delete port ${p.name}? Any cable connected to it must be removed first.`))return;try{await api(`/ports/${p.id}`,{method:'DELETE'});load()}catch(e){setError(e instanceof Error?e.message:'Could not delete port — it may still have a cable connected')}};
  return <><div className="page-head"><div><h1>Ports</h1><p>Physical and logical interfaces on your devices.</p></div><button className="primary" onClick={startCreate}><Plus size={16}/>Add port</button></div>
    {error&&!open&&<div className="form-error page-error">{error}</div>}
    <section className="panel">{items.length===0?<div className="resource-empty"><Plug/><h2>No ports yet</h2><p>Add the interfaces you want to track and cable.</p><button className="primary" onClick={startCreate}><Plus size={15}/>Add port</button></div>:<div className="table-wrap"><table><thead><tr><th>Port</th><th>Device</th><th>Type</th><th>Speed</th><th>Status</th><th/></tr></thead><tbody>{items.map(p=><tr key={p.id}><td><span className="resource-name"><Plug/><strong>{p.name}</strong></span></td><td>{devices.find(d=>d.id===p.device_id)?.name??'—'}</td><td>{p.type}</td><td>{p.speed||'—'}</td><td><span className={'status '+(p.enabled?'active':'maintenance')}><i/>{p.enabled?'Enabled':'Disabled'}</span></td><td><RowMenu items={[{label:'Edit port',onClick:()=>startEdit(p)},{label:'Delete port',danger:true,onClick:()=>void remove(p)}]}/></td></tr>)}</tbody></table></div>}</section>
    {open&&<Modal title={editing?'Edit port':'Add port'} close={()=>setOpen(false)} save={save} error={error} saveLabel={editing?'Save changes':'Save'}><label>Device<select value={form.device_id} onChange={e=>setForm(f=>({...f,device_id:e.target.value}))}>{devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Port name<input autoFocus value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Gi0/1"/></label><div className="form-row"><label>Type<select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>{PORT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></label><label>Speed (optional)<input value={form.speed} onChange={e=>setForm(f=>({...f,speed:e.target.value}))} placeholder="1G, 10G, 40G..."/></label></div><label><input type="checkbox" checked={form.enabled} onChange={e=>setForm(f=>({...f,enabled:e.target.checked}))}/> Enabled</label><label>Description (optional)<textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></label></Modal>}
  </>;
}

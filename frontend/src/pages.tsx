import {useEffect,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {Activity,AlertTriangle,Cable,ChevronRight,CornerDownRight,MapPin,Network,PanelsTopLeft as Racks,Plus,Server,Tags,X} from 'lucide-react';
import {api,type ConnectionEdge,type Device,type NetworkRow,type Port,type Rack,type Site} from './lib/api';
import {cidrContains,isIPv6Prefix,parseCIDR} from './lib/cidr';
import {RowMenu} from './RowMenu';

const title=(heading:string,desc:string,action?:string,onAction?:()=>void)=><div className="page-head"><div><h1>{heading}</h1><p>{desc}</p></div>{action&&<button className="primary" onClick={onAction}><Plus size={15}/>{action}</button>}</div>;
const Status=({value}:{value:string})=><span className={'status '+value}><i/>{value}</span>;

function Modal({title,description,close,save,error,saveLabel='Save',saveDisabled,children}:{title:string;description:string;close:()=>void;save:()=>void;error:string;saveLabel?:string;saveDisabled?:boolean;children:React.ReactNode}){
  return <div className="modal-backdrop"><div className="resource-modal"><header><div><h2>{title}</h2><p>{description}</p></div><button onClick={close}><X/></button></header><div className="resource-form">{children}{error&&<div className="form-error">{error}</div>}</div><footer><button className="cancel" onClick={close}>Cancel</button><button className="primary" disabled={saveDisabled} onClick={save}>{saveLabel}</button></footer></div></div>;
}

// ---------- Dashboard ----------

type DashboardStats={sites:number;racks:number;devices:number;active_devices:number;networks:number;vlans:number;connections:number};
type Me={name:string};

export function Dashboard(){
  const [stats,setStats]=useState<DashboardStats|null>(null);
  const [devices,setDevices]=useState<Device[]>([]);
  const [racks,setRacks]=useState<Rack[]>([]);
  const [sites,setSites]=useState<Site[]>([]);
  const [me,setMe]=useState<Me|null>(null);
  const [error,setError]=useState('');
  const load=()=>Promise.all([
    api<DashboardStats>('/dashboard'),
    api<Device[]>('/devices?page_size=100'),
    api<Rack[]>('/racks?page_size=100'),
    api<Site[]>('/sites?page_size=100'),
    api<Me>('/auth/me'),
  ]).then(([s,d,r,st,m])=>{setStats(s);setDevices(d);setRacks(r);setSites(st);setMe(m)}).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);
  const removeDevice=async(d:Device)=>{if(!confirm(`Delete ${d.name}?`))return;try{await api(`/devices/${d.id}`,{method:'DELETE'});load()}catch(e){setError(e instanceof Error?e.message:'Could not delete device')}};

  const hour=new Date().getHours();
  const greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
  const stat=[['Sites',stats?.sites,MapPin],['Racks',stats?.racks,Racks],['Devices',stats?.devices,Server],['Active devices',stats?.active_devices,Activity],['Networks',stats?.networks,Network],['VLANs',stats?.vlans,Tags],['Connections',stats?.connections,Cable]] as const;

  const primaryRack=racks[0];
  const rackDevices=primaryRack?devices.filter(d=>d.rack_id===primaryRack.id):[];
  const occupied=rackDevices.reduce((sum,d)=>sum+(d.rack_height||0),0);
  const percent=primaryRack&&primaryRack.rack_units>0?Math.min(100,Math.round(occupied/primaryRack.rack_units*100)):0;
  const rackSite=primaryRack?sites.find(s=>s.id===primaryRack.site_id):undefined;
  const attention=devices.filter(d=>d.status==='maintenance'||d.status==='offline').slice(0,3);

  if(error)return <div className="form-error page-error">{error}</div>;
  return <>
    {title(`${greeting}${me?`, ${me.name.split(/\s+/)[0]}`:''}`,'Infrastructure at a glance.')}
    <div className="stats">{stat.map(([n,v,I])=><div className="stat" key={n}><span><I size={19}/></span><div><strong>{v??'—'}</strong><small>{n}</small></div></div>)}</div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-head"><div><h2>Recent devices</h2><p>Latest infrastructure additions</p></div><Link to="/devices">View all <ChevronRight size={15}/></Link></div><DeviceTable items={devices.slice(0,4)} onDelete={removeDevice}/></section>
      <section className="panel utilization"><div className="panel-head"><div><h2>Rack utilization</h2><p>Occupied rack capacity</p></div></div>
        {primaryRack?<div className="rack-summary"><div className="ring" style={{background:`conic-gradient(var(--tech) 0 ${percent}%,#edf1f5 ${percent}%)`}}><strong>{percent}%</strong></div><div><strong>{primaryRack.name}</strong><p>{rackSite?.name??'—'}</p><div className="bar"><i style={{width:`${percent}%`}}/></div><small>{occupied}U used · {Math.max(0,primaryRack.rack_units-occupied)}U available</small></div></div>:<div className="resource-empty"><Racks/><h2>No racks yet</h2><p>Add a rack to track capacity here.</p></div>}
        <Link className="outline" to="/racks">Open rack view</Link>
      </section>
    </div>
    <section className="panel"><div className="panel-head"><div><h2>Needs attention</h2><p>Devices currently in maintenance or offline</p></div></div>
      {attention.length===0?<div className="resource-empty"><Activity/><h2>All clear</h2><p>No devices currently need attention.</p></div>:attention.map(d=><Link to={`/devices?q=${encodeURIComponent(d.name)}`} className="attention" key={d.id}><span><AlertTriangle/></span><div><strong>{d.name}</strong><p>{d.management_ip||'No IP'}{d.rack_position?` · U${d.rack_position}`:''}</p></div><Status value={d.status}/><ChevronRight/></Link>)}
    </section>
  </>;
}

function DeviceTable({items,onEdit,onDelete}:{items:Device[];onEdit?:(d:Device)=>void;onDelete:(d:Device)=>void}){
  return <div className="table-wrap"><table><thead><tr><th>Device</th><th>Type</th><th>Management IP</th><th>Rack position</th><th>Status</th><th/></tr></thead><tbody>
    {items.map(d=><tr key={d.id}><td><Link to={'/devices?q='+encodeURIComponent(d.name)}><span className={'device-icon '+d.device_type}><Server size={16}/></span><strong>{d.name}</strong></Link></td><td className="capitalize">{d.device_type}</td><td className="mono">{d.management_ip||'—'}</td><td>{d.rack_position?`U${d.rack_position}${d.rack_height>1?`–U${d.rack_position+d.rack_height-1}`:''}`:'—'}</td><td><Status value={d.status}/></td><td><RowMenu items={[...(onEdit?[{label:'Edit device',onClick:()=>onEdit(d)}]:[]),{label:'Delete device',danger:true,onClick:()=>onDelete(d)}]}/></td></tr>)}
    {items.length===0&&<tr><td colSpan={6}>No devices yet.</td></tr>}
  </tbody></table></div>;
}

// ---------- Devices ----------

const editableDeviceFields={name:'',device_type:'switch',status:'active',management_ip:'',description:''};

export function DevicesPage(){
  const q=new URLSearchParams(useLocation().search).get('q')?.toLowerCase();
  const [devices,setDevices]=useState<Device[]>([]);
  const [error,setError]=useState('');
  const [editing,setEditing]=useState<Device|null>(null);
  const [form,setForm]=useState(editableDeviceFields);
  const load=()=>api<Device[]>('/devices?page_size=100').then(setDevices).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);
  const items=q?devices.filter(d=>d.name.toLowerCase().includes(q)||d.management_ip?.includes(q)):devices;

  const startEdit=(d:Device)=>{setEditing(d);setForm({name:d.name,device_type:d.device_type,status:d.status,management_ip:d.management_ip||'',description:d.description||''});setError('')};
  const save=async()=>{if(!editing)return;try{const body:Record<string,string>={name:form.name,device_type:form.device_type,status:form.status,description:form.description,management_ip:form.management_ip};await api(`/devices/${editing.id}`,{method:'PUT',body:JSON.stringify(body)});setEditing(null);load()}catch(e){setError(e instanceof Error?e.message:'Could not save device')}};
  const remove=async(d:Device)=>{if(!confirm(`Delete ${d.name}? This also removes its ports and connections.`))return;try{await api(`/devices/${d.id}`,{method:'DELETE'});load()}catch(e){setError(e instanceof Error?e.message:'Could not delete device')}};

  return <>
    {title('Devices','Manage routers, switches, servers, and other equipment.','Add device',()=>window.dispatchEvent(new Event('atlas:quick-add')))}
    {error&&<div className="form-error page-error">{error}</div>}
    <div className="toolbar"><div className="search-box">⌕ <input placeholder="Search devices…" defaultValue={q??''} onKeyDown={event=>{if(event.key==='Enter')window.location.search='?q='+encodeURIComponent((event.target as HTMLInputElement).value)}}/></div></div>
    <section className="panel"><DeviceTable items={items} onEdit={startEdit} onDelete={remove}/><div className="pagination">Showing {items.length} of {devices.length} devices</div></section>
    {editing&&<Modal title="Edit device" description="Update identity, status, and management address." close={()=>setEditing(null)} save={()=>void save()} error={error} saveDisabled={!form.name}>
      <label>Device name<input autoFocus value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></label>
      <label>Device type<select value={form.device_type} onChange={e=>setForm(f=>({...f,device_type:e.target.value}))}>{['router','switch','server','firewall','olt','onu','storage','patch_panel','pdu','ups','wireless','rectifier','inverter','battery_bank','generator','transfer_switch','other'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Status<select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{['active','planned','offline','maintenance','decommissioned'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Management IP<input value={form.management_ip} onChange={e=>setForm(f=>({...f,management_ip:e.target.value}))} placeholder="10.10.0.4 (leave blank to clear)"/></label>
      <label>Description<textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></label>
    </Modal>}
  </>;
}

// ---------- Racks ----------

const emptyRack={site_id:'',room_id:'',name:'',rack_units:42,description:''};

export function RackPage(){
  const [racks,setRacks]=useState<Rack[]>([]);
  const [devices,setDevices]=useState<Device[]>([]);
  const [sites,setSites]=useState<Site[]>([]);
  const [selected,setSelected]=useState('');
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState(emptyRack);
  const [error,setError]=useState('');
  const load=()=>Promise.all([api<Rack[]>('/racks?page_size=100'),api<Device[]>('/devices?page_size=100'),api<Site[]>('/sites?page_size=100')]).then(([r,d,s])=>{setRacks(r);setDevices(d);setSites(s);setSelected(current=>current&&r.some(x=>x.id===current)?current:r[0]?.id??'');setForm(f=>({...f,site_id:f.site_id||s[0]?.id||''}))}).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);

  const rack=racks.find(r=>r.id===selected);
  const site=rack?sites.find(s=>s.id===rack.site_id):undefined;
  const rackDevices=rack?devices.filter(d=>d.rack_id===rack.id):[];
  const occupied=rackDevices.reduce((sum,d)=>sum+(d.rack_height||0),0);
  const percent=rack&&rack.rack_units>0?Math.min(100,Math.round(occupied/rack.rack_units*100)):0;
  const units=rack?Array.from({length:rack.rack_units},(_,i)=>rack.rack_units-i):[];
  const at=new Map<number,Device>();rackDevices.forEach(d=>{for(let i=0;i<d.rack_height;i++)at.set(d.rack_position+i,d)});

  const save=async()=>{try{const body:Record<string,unknown>={site_id:form.site_id,name:form.name,rack_units:form.rack_units,description:form.description};if(form.room_id)body.room_id=form.room_id;await api('/racks',{method:'POST',body:JSON.stringify(body)});setOpen(false);setForm(f=>({...f,name:'',description:''}));load()}catch(e){setError(e instanceof Error?e.message:'Could not create rack')}};
  const removeRack=async()=>{if(!rack||!confirm(`Delete ${rack.name}? Devices placed here will keep their record but lose their rack position.`))return;try{await api(`/racks/${rack.id}`,{method:'DELETE'});load()}catch(e){setError(e instanceof Error?e.message:'Could not delete rack')}};

  return <>
    {title('Racks','Visualize equipment placement and available capacity.','Add rack',()=>setOpen(true))}
    {error&&<div className="form-error page-error">{error}</div>}
    {racks.length===0?<section className="panel empty"><Racks/><h2>No racks yet</h2><p>Add your first rack to start placing equipment.</p></section>:<>
      {racks.length>1&&<div className="toolbar">{racks.map(r=><button key={r.id} className="filter" style={r.id===selected?{borderColor:'var(--tech)',color:'var(--tech)'}:undefined} onClick={()=>setSelected(r.id)}>{r.name}</button>)}</div>}
      <div className="rack-layout">
        <section className="panel rack-card"><div className="rack-title"><div><h2>{rack?.name}</h2><p><MapPin size={14}/> {site?.name??'No site'}</p></div><div><strong>{rack?.rack_units}U</strong><small>{occupied}U occupied</small><RowMenu items={[{label:'Delete rack',danger:true,onClick:()=>void removeRack()}]}/></div></div>
          <div className="rack-visual">{units.map(u=>{const d=at.get(u);const top=d&&(d.rack_position+d.rack_height-1===u);return <div className="rack-unit" key={u}><span>{String(u).padStart(2,'0')}</span>{d&&top?<Link to={'/devices?q='+encodeURIComponent(d.name)} className={'rack-device '+d.device_type} style={{height:`calc(${d.rack_height} * 28px - 2px)`}}><b>{d.name}</b><small>{d.device_type} · {d.rack_height}U</small></Link>:!d?<i/>:null}</div>})}</div>
        </section>
        <aside className="panel rack-info"><h2>Rack overview</h2><div className="big-number">{percent}%</div><div className="bar"><i style={{width:`${percent}%`}}/></div><div className="split"><span>Occupied<strong>{occupied}U</strong></span><span>Available<strong>{Math.max(0,(rack?.rack_units??0)-occupied)}U</strong></span></div><hr/><h3>Equipment</h3>
          {rackDevices.length===0?<p className="cell-detail">No devices placed in this rack.</p>:rackDevices.map(d=><Link to={'/devices?q='+encodeURIComponent(d.name)} key={d.id}><span className={'dot '+d.device_type}/><div><strong>{d.name}</strong><small>U{d.rack_position} · {d.rack_height}U</small></div><Status value={d.status}/></Link>)}
        </aside>
      </div>
    </>}
    {open&&<Modal title="Add rack" description="Racks belong to a site and hold devices." close={()=>setOpen(false)} save={()=>void save()} error={error} saveDisabled={!form.name||!form.site_id}>
      <label>Site<select value={form.site_id} onChange={e=>setForm(f=>({...f,site_id:e.target.value}))}>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Rack name<input autoFocus value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="RACK-CORE-01"/></label>
      <label>Height (U)<input type="number" min={1} max={100} value={form.rack_units} onChange={e=>setForm(f=>({...f,rack_units:+e.target.value}))}/></label>
      <label>Description<textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></label>
    </Modal>}
  </>;
}

// ---------- Connections ----------

const emptyConnection={port_a_id:'',port_b_id:'',cable_type:'cat6',label:''};

export function ConnectionsPage(){
  const [links,setLinks]=useState<ConnectionEdge[]>([]);
  const [devices,setDevices]=useState<Device[]>([]);
  const [portsByDevice,setPortsByDevice]=useState<Record<string,Port[]>>({});
  const [deviceA,setDeviceA]=useState('');
  const [deviceB,setDeviceB]=useState('');
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState(emptyConnection);
  const [error,setError]=useState('');
  const load=()=>Promise.all([api<ConnectionEdge[]>('/topology'),api<Device[]>('/devices?page_size=100')]).then(([l,d])=>{setLinks(l);setDevices(d)}).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);

  const loadPorts=(deviceId:string)=>{if(!deviceId||portsByDevice[deviceId])return;api<Port[]>(`/devices/${deviceId}/ports`).then(ports=>setPortsByDevice(current=>({...current,[deviceId]:ports}))).catch(()=>undefined)};
  useEffect(()=>{loadPorts(deviceA)},[deviceA]);
  useEffect(()=>{loadPorts(deviceB)},[deviceB]);

  const startAdd=()=>{setForm(emptyConnection);setDeviceA('');setDeviceB('');setError('');setOpen(true)};
  const save=async()=>{try{await api('/connections',{method:'POST',body:JSON.stringify(form)});setOpen(false);load()}catch(e){setError(e instanceof Error?e.message:'Could not create connection')}};
  const remove=async(cableId:string)=>{if(!confirm('Remove this connection?'))return;try{await api(`/connections/${cableId}`,{method:'DELETE'});load()}catch(e){setError(e instanceof Error?e.message:'Could not remove connection')}};

  return <>
    {title('Connections','Trace physical cables between device ports.','Add connection',startAdd)}
    {error&&!open&&<div className="form-error page-error">{error}</div>}
    <section className="panel">{links.length===0?<div className="resource-empty"><Cable/><h2>No connections yet</h2><p>Cable two device ports together to document a link.</p><button className="primary" onClick={startAdd}><Plus size={15}/>Add connection</button></div>:<div className="connection-list">{links.map((c,i)=><div className="connection" key={c.cable_id}><span className="cable-id">C-{String(i+1).padStart(3,'0')}</span><div><strong>{c.device_a_name}</strong><small>{c.port_a}</small></div><div className="cable-line"><i/><Cable size={17}/><i/></div><div><strong>{c.device_b_name}</strong><small>{c.port_b}</small></div><span className="cable-kind">{c.cable_type}</span><RowMenu items={[{label:'Remove connection',danger:true,onClick:()=>void remove(c.cable_id)}]}/></div>)}</div>}</section>
    {open&&<Modal title="Add connection" description="Pick a port on each device and how they're cabled." close={()=>setOpen(false)} save={()=>void save()} error={error} saveDisabled={!form.port_a_id||!form.port_b_id}>
      <label>Device A<select value={deviceA} onChange={e=>{setDeviceA(e.target.value);setForm(f=>({...f,port_a_id:''}))}}><option value="">Select a device</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>Port A<select value={form.port_a_id} disabled={!deviceA} onChange={e=>setForm(f=>({...f,port_a_id:e.target.value}))}><option value="">Select a port</option>{(portsByDevice[deviceA]||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Device B<select value={deviceB} onChange={e=>{setDeviceB(e.target.value);setForm(f=>({...f,port_b_id:''}))}}><option value="">Select a device</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>Port B<select value={form.port_b_id} disabled={!deviceB} onChange={e=>setForm(f=>({...f,port_b_id:e.target.value}))}><option value="">Select a port</option>{(portsByDevice[deviceB]||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Cable type<select value={form.cable_type} onChange={e=>setForm(f=>({...f,cable_type:e.target.value}))}>{['cat5e','cat6','cat6a','dac','fiber_sm','fiber_mm','power','wireless','other'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Label (optional)<input value={form.label} onChange={e=>setForm(f=>({...f,label:e.target.value}))}/></label>
    </Modal>}
  </>;
}

// ---------- Networks ----------

const emptyNetwork={site_id:'',prefix:'',name:'',gateway:'',description:''};

function ipv4Capacity(prefix:string):number|null{
  const match=/^\d{1,3}(?:\.\d{1,3}){3}\/(\d{1,2})$/.exec(prefix.trim());
  if(!match)return null;
  const bits=32-parseInt(match[1],10);
  if(bits<0||bits>32)return null;
  return Math.max(0,Math.pow(2,bits)-2);
}

// Networks nest purely by CIDR containment (no parent_id column — see the
// backend's networkAddresses handler), so the tree shown here is derived the
// same way: for every network, its parent is the narrowest other network
// whose prefix contains it.
type TreeNode=NetworkRow&{children:TreeNode[]};
function buildForest(networks:NetworkRow[]):TreeNode[]{
  const nodes:TreeNode[]=networks.map(n=>({...n,children:[]}));
  const parentOf=new Map<string,TreeNode>();
  for(const n of nodes){
    let best:TreeNode|undefined,bestBits=-1;
    for(const other of nodes){
      if(other.id===n.id)continue;
      if(cidrContains(other.prefix,n.prefix)){
        const bits=parseCIDR(other.prefix)?.bits??-1;
        if(bits>bestBits){best=other;bestBits=bits}
      }
    }
    if(best)parentOf.set(n.id,best);
  }
  for(const n of nodes){const p=parentOf.get(n.id);if(p)p.children.push(n)}
  const roots=nodes.filter(n=>!parentOf.has(n.id));
  const byBase=(a:TreeNode,b:TreeNode)=>{const ba=parseCIDR(a.prefix)?.base??0n,bb=parseCIDR(b.prefix)?.base??0n;return ba<bb?-1:ba>bb?1:0};
  const sortRec=(list:TreeNode[])=>{list.sort(byBase);list.forEach(n=>sortRec(n.children))};
  sortRec(roots);
  return roots;
}
function countDescendants(n:TreeNode):number{return n.children.reduce((sum,c)=>sum+1+countDescendants(c),0)}

function NetworkRowGroup({node,depth,sites,onEdit,onDelete}:{node:TreeNode;depth:number;sites:Site[];onEdit:(n:NetworkRow)=>void;onDelete:(n:NetworkRow)=>void}){
  const capacity=ipv4Capacity(node.prefix);
  const used=node.used_count||0;
  const pct=capacity?Math.min(100,Math.round(used/capacity*100)):0;
  const descendants=countDescendants(node);
  const isV6=isIPv6Prefix(node.prefix);
  return <div className="network-node">
    <div className={depth===0?'network-row':'network-row nested'}>
      <div className="network-prefix-cell" style={depth>0?{paddingLeft:(depth-1)*24}:undefined}>
        {depth>0&&<CornerDownRight size={14} className="network-connector-icon"/>}
        <Link to={`/networks/${node.id}`} className="mono linkish">{node.prefix}</Link>
        {descendants>0&&<span className="network-subnet-count">{descendants} subnet{descendants>1?'s':''}</span>}
      </div>
      <div><strong>{node.name}</strong></div>
      <div>{sites.find(s=>s.id===node.site_id)?.name??'—'}</div>
      <div className="mono">{node.gateway||'—'}</div>
      <div>{capacity?<><span className="mini-bar"><i style={{width:`${pct}%`}}/></span>{used} / {capacity}</>:isV6?<span className="cell-detail">{used} documented</span>:'—'}</div>
      <div><RowMenu items={[{label:'Edit network',onClick:()=>onEdit(node)},{label:'Delete network',danger:true,onClick:()=>onDelete(node)}]}/></div>
    </div>
    {node.children.length>0&&<div className="network-children">
      {node.children.map(child=><NetworkRowGroup key={child.id} node={child} depth={depth+1} sites={sites} onEdit={onEdit} onDelete={onDelete}/>)}
    </div>}
  </div>;
}

export function NetworksPage(){
  const [networks,setNetworks]=useState<NetworkRow[]>([]);
  const [sites,setSites]=useState<Site[]>([]);
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState<NetworkRow|null>(null);
  const [form,setForm]=useState(emptyNetwork);
  const [error,setError]=useState('');
  const load=()=>Promise.all([api<NetworkRow[]>('/networks?page_size=100'),api<Site[]>('/sites?page_size=100')]).then(([n,s])=>{setNetworks(n);setSites(s)}).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);

  const startAdd=()=>{setEditing(null);setForm(emptyNetwork);setError('');setOpen(true)};
  const startEdit=(n:NetworkRow)=>{setEditing(n);setForm({site_id:n.site_id||'',prefix:n.prefix,name:n.name,gateway:n.gateway||'',description:n.description||''});setError('');setOpen(true)};
  const save=async()=>{try{const body=editing?{...form,site_id:form.site_id||null,gateway:form.gateway||null}:Object.fromEntries(Object.entries(form).filter(([,v])=>v!==''));if(editing)await api(`/networks/${editing.id}`,{method:'PUT',body:JSON.stringify(body)});else await api('/networks',{method:'POST',body:JSON.stringify(body)});setOpen(false);load()}catch(e){setError(e instanceof Error?e.message:'Could not save network')}};
  const remove=async(n:NetworkRow)=>{if(!confirm(`Delete ${n.name}?`))return;try{await api(`/networks/${n.id}`,{method:'DELETE'});load()}catch(e){setError(e instanceof Error?e.message:'Could not delete network')}};

  const forest=buildForest(networks);
  const parentHint=(()=>{
    if(!form.prefix)return null;
    let best:NetworkRow|undefined,bestBits=-1;
    for(const n of networks){
      if(n.id===editing?.id)continue;
      if(cidrContains(n.prefix,form.prefix)){
        const bits=parseCIDR(n.prefix)?.bits??-1;
        if(bits>bestBits){best=n;bestBits=bits}
      }
    }
    return best;
  })();

  return <>
    {title('Networks','Document IPv4 and IPv6 address space.','Add network',startAdd)}
    {error&&!open&&<div className="form-error page-error">{error}</div>}
    {networks.length===0?<section className="panel"><div className="resource-empty"><Network/><h2>No networks yet</h2><p>Document a prefix to start assigning addresses.</p><button className="primary" onClick={startAdd}><Plus size={15}/>Add network</button></div></section>:<section className="panel network-tree">
      <div className="network-row header"><div>Prefix</div><div>Name</div><div>Site</div><div>Gateway</div><div>Utilization</div><div/></div>
      {forest.map(n=><NetworkRowGroup key={n.id} node={n} depth={0} sites={sites} onEdit={startEdit} onDelete={target=>void remove(target)}/>)}
    </section>}
    {open&&<Modal title={editing?'Edit network':'Add network'} description="Document a routed prefix to assign addresses from." close={()=>setOpen(false)} save={()=>void save()} error={error} saveLabel={editing?'Save changes':'Add network'} saveDisabled={!form.prefix||!form.name}>
      <label>Prefix (CIDR)<input autoFocus value={form.prefix} onChange={e=>setForm(f=>({...f,prefix:e.target.value}))} placeholder="10.10.0.0/24 or 2001:db8::/48"/></label>
      {parentHint&&<p className="cidr-hint ok">✓ Nests under {parentHint.prefix} · {parentHint.name} automatically</p>}
      <label>Name<input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Management"/></label>
      <label>Site (optional)<select value={form.site_id} onChange={e=>setForm(f=>({...f,site_id:e.target.value}))}><option value="">No site</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Gateway (optional)<input value={form.gateway} onChange={e=>setForm(f=>({...f,gateway:e.target.value}))} placeholder="10.10.0.1"/></label>
      <label>Description<textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></label>
    </Modal>}
  </>;
}

export function PlaceholderPage(){return <>{title('Coming into focus','This section is wired into the application shell and ready for its resource workflow.')}<section className="panel empty"><Network/><h2>Infrastructure at a glance</h2><p>Use the primary MVP areas in the sidebar to explore the seeded environment.</p></section></>}

import {useEffect,useMemo,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {ChevronLeft,Network,Plus,Search,Server,X} from 'lucide-react';
import {api,type Device,type NetworkAddress,type NetworkRow,type RelatedNetwork} from './lib/api';
import {cidrContains} from './lib/cidr';
import {RowMenu} from './RowMenu';

const emptyForm={address:'',device_id:'',assigned_to:'',dns_name:'',description:'',status:'active'};
const emptySubnet={prefix:'',name:'',gateway:'',description:''};
type Filter='all'|'free'|'used';

async function fetchAddresses(id:string):Promise<{data:NetworkAddress[];family:'ipv4'|'ipv6';parent:RelatedNetwork|null;subnets:RelatedNetwork[]}>{
  const response=await fetch('/api/v1/networks/'+id+'/addresses',{credentials:'include'});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body?.error?.message??'Could not load addresses');
  return {data:body.data??[],family:body.meta?.family==='ipv6'?'ipv6':'ipv4',parent:body.meta?.parent??null,subnets:body.meta?.subnets??[]};
}

export function NetworkAddressesPage(){
  const {id=''}=useParams();
  const nav=useNavigate();
  const [network,setNetwork]=useState<NetworkRow|null>(null);
  const [addresses,setAddresses]=useState<NetworkAddress[]>([]);
  const [family,setFamily]=useState<'ipv4'|'ipv6'>('ipv4');
  const [parent,setParent]=useState<RelatedNetwork|null>(null);
  const [subnets,setSubnets]=useState<RelatedNetwork[]>([]);
  const [devices,setDevices]=useState<Device[]>([]);
  const [q,setQ]=useState('');
  const [filter,setFilter]=useState<Filter>('all');
  const [editing,setEditing]=useState<NetworkAddress|null>(null);
  const [form,setForm]=useState(emptyForm);
  const [addingSubnet,setAddingSubnet]=useState(false);
  const [subnetForm,setSubnetForm]=useState(emptySubnet);
  const [subnetError,setSubnetError]=useState('');
  const [error,setError]=useState('');
  const [loadError,setLoadError]=useState('');

  const load=()=>Promise.all([
    api<NetworkRow>('/networks/'+id),
    fetchAddresses(id),
    api<Device[]>('/devices?page_size=100'),
  ]).then(([n,a,d])=>{setNetwork(n);setAddresses(a.data);setFamily(a.family);setParent(a.parent);setSubnets(a.subnets);setDevices(d);setLoadError('')}).catch(e=>setLoadError(e instanceof Error?e.message:'Could not load network'));
  useEffect(()=>{void load()},[id]);

  const filtered=useMemo(()=>{
    const needle=q.trim().toLowerCase();
    return addresses.filter(a=>{
      if(filter==='free'&&a.status!=='free')return false;
      if(filter==='used'&&a.status==='free')return false;
      if(!needle)return true;
      return a.address.includes(needle)||!!a.device_name?.toLowerCase().includes(needle)||!!a.assigned_to?.toLowerCase().includes(needle)||!!a.dns_name?.toLowerCase().includes(needle)||!!a.subnet_prefix?.includes(needle);
    });
  },[addresses,q,filter]);

  const total=addresses.length;
  const used=addresses.filter(a=>a.status!=='free').length;
  const percent=total?Math.round(used/total*100):0;

  const openAssign=(a:NetworkAddress)=>{
    if(!a.id&&a.subnet_id){nav(`/networks/${a.subnet_id}`);return}
    setEditing(a);setForm({address:a.address,device_id:a.device_id||'',assigned_to:a.assigned_to||'',dns_name:a.dns_name||'',description:a.description||'',status:a.id?a.status:'active'});setError('');
  };
  // IPv6 space is never enumerated (see fetchAddresses), so there's no "free"
  // row to click — the user documents an address by typing it directly.
  const startAddAddress=()=>{setEditing({address:'',status:'free'});setForm({...emptyForm,status:'active'});setError('')};
  const close=()=>setEditing(null);
  const save=async()=>{
    if(!editing)return;
    setError('');
    const address=(editing.id?editing.address:form.address).trim();
    const body={network_id:id,address,device_id:form.device_id||null,assigned_to:form.assigned_to.trim()||null,dns_name:form.dns_name.trim()||null,description:form.description.trim()||null,status:form.status};
    try{
      if(editing.id)await api(`/ip-addresses/${editing.id}`,{method:'PUT',body:JSON.stringify(body)});
      else await api('/ip-addresses',{method:'POST',body:JSON.stringify(body)});
      close();load();
    }catch(e){setError(e instanceof Error?e.message:'Could not save address')}
  };
  const release=async(a:NetworkAddress)=>{
    if(!a.id||!confirm(`Release ${a.address}? It will show as free again.`))return;
    try{await api(`/ip-addresses/${a.id}`,{method:'DELETE'});load()}catch(e){setError(e instanceof Error?e.message:'Could not release address')}
  };
  const startSubnet=()=>{setSubnetForm(emptySubnet);setSubnetError('');setAddingSubnet(true)};
  const closeSubnet=()=>setAddingSubnet(false);
  const saveSubnet=async()=>{
    setSubnetError('');
    try{
      const body=Object.fromEntries(Object.entries({site_id:network?.site_id||'',prefix:subnetForm.prefix,name:subnetForm.name,gateway:subnetForm.gateway,description:subnetForm.description}).filter(([,v])=>v!==''));
      await api('/networks',{method:'POST',body:JSON.stringify(body)});
      closeSubnet();load();
    }catch(e){setSubnetError(e instanceof Error?e.message:'Could not create subnet')}
  };
  const subnetContained=network?cidrContains(network.prefix,subnetForm.prefix):null;
  const targetLabel=(a:NetworkAddress)=>a.device_name?<span className="resource-name"><Server size={14}/><strong>{a.device_name}</strong></span>:a.assigned_to?<strong>{a.assigned_to}</strong>:a.subnet_id?<Link to={`/networks/${a.subnet_id}`} className="linkish">{a.subnet_prefix} · {a.subnet_name}</Link>:<span className="cell-detail">—</span>;

  const backLink=<Link to="/networks" className="linkish back-link"><ChevronLeft size={14}/> Networks</Link>;
  if(loadError)return <>{backLink}<div className="form-error page-error">{loadError}</div></>;
  if(!network)return null;

  return <>
    <div className="page-head"><div>{backLink}<h1>{network.name}</h1><p className="mono">{network.prefix}{network.gateway?` · Gateway ${network.gateway}`:''}</p>{parent&&<p className="cell-detail">Subnet of <Link to={`/networks/${parent.id}`} className="linkish">{parent.prefix} · {parent.name}</Link></p>}</div><button className="primary" onClick={startSubnet}><Plus size={15}/>Add subnet</button></div>
    {family==='ipv4'?
      <div className="rack-summary panel"><div className="ring" style={{background:`conic-gradient(var(--tech) 0 ${percent}%,#edf1f5 ${percent}%)`}}><strong>{percent}%</strong></div><div><strong>{used} / {total} addresses used</strong><p>{Math.max(0,total-used)} free{subnets.length>0?` · ${subnets.length} subnet${subnets.length>1?'s':''} nested inside`:''}</p><div className="bar"><i style={{width:`${percent}%`}}/></div></div></div>
      :<div className="panel v6-summary"><div><strong>{total} address{total===1?'':'es'} documented</strong><p>IPv6 space is too vast to list free addresses — document the ones you assign.{subnets.length>0?` · ${subnets.length} subnet${subnets.length>1?'s':''} nested inside`:''}</p></div><button className="primary" onClick={startAddAddress}><Plus size={15}/>Add address</button></div>}
    {subnets.length>0&&<section className="panel"><div className="panel-head"><div><h2>Subnets in this range</h2><p>Any network whose prefix falls inside {network.prefix} is nested here automatically.</p></div></div><div className="subnet-chips">{subnets.map(s=><Link to={`/networks/${s.id}`} key={s.id} className="subnet-chip"><Network size={14}/><strong>{s.prefix}</strong><span>{s.name}</span></Link>)}</div></section>}
    <div className="toolbar">
      <div className="search-box"><Search size={15}/><input placeholder="Search IP, device, name…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      {family==='ipv4'&&<select className="filter" value={filter} onChange={e=>setFilter(e.target.value as Filter)}><option value="all">All addresses</option><option value="free">Free only</option><option value="used">Used only</option></select>}
    </div>
    {error&&!editing&&<div className="form-error page-error">{error}</div>}
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>Address</th><th>Status</th><th>Assigned to</th><th>DNS name</th><th/></tr></thead><tbody>
      {filtered.map(a=><tr key={a.address} className={a.status==='free'?'ip-free-row':''}>
        <td className="mono linkish" onClick={()=>openAssign(a)}>{a.address}{a.special&&<small className="cell-detail">{a.special==='network'?'Network address':'Broadcast address'}</small>}{a.id&&a.subnet_id&&<small className="cell-detail">via {a.subnet_prefix}</small>}</td>
        <td><span className={'status '+a.status}><i/>{a.status}</span></td>
        <td>{targetLabel(a)}</td>
        <td>{a.dns_name||'—'}</td>
        <td>{a.id?<RowMenu items={[{label:'Edit assignment',onClick:()=>openAssign(a)},{label:'Release address',danger:true,onClick:()=>void release(a)}]}/>:a.subnet_id?<Link to={`/networks/${a.subnet_id}`} className="add-link">Open subnet</Link>:<button type="button" className="add-link" onClick={()=>openAssign(a)}>Assign</button>}</td>
      </tr>)}
      {filtered.length===0&&<tr><td colSpan={5}>{family==='ipv6'?'No addresses documented yet — use "Add address" above.':'No addresses match.'}</td></tr>}
    </tbody></table></div></section>
    {editing&&<div className="modal-backdrop"><div className="resource-modal"><header><div><h2>{editing.id?'Edit assignment':'Assign address'}</h2>{editing.id?<p className="mono">{editing.address}</p>:<p>{family==='ipv6'?'Type the IPv6 address to document.':'Confirm or adjust the address to assign.'}</p>}</div><button onClick={close}><X/></button></header><div className="resource-form">
      {!editing.id&&<label>Address<input autoFocus className="mono" value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder={family==='ipv6'?'2001:db8::10':'10.10.0.25'}/></label>}
      <label>Device (optional)<select value={form.device_id} onChange={e=>setForm(f=>({...f,device_id:e.target.value}))}><option value="">No device</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name} · {d.device_type}</option>)}</select></label>
      <label>Assigned to / client (optional)<input value={form.assigned_to} onChange={e=>setForm(f=>({...f,assigned_to:e.target.value}))} placeholder="Customer or contact name"/></label>
      <label>DNS name (optional)<input value={form.dns_name} onChange={e=>setForm(f=>({...f,dns_name:e.target.value}))} placeholder="host.example.local"/></label>
      <label>Status<select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option value="active">Active</option><option value="reserved">Reserved</option><option value="available">Available</option><option value="deprecated">Deprecated</option></select></label>
      <label>Notes<textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></label>
      {error&&<div className="form-error">{error}</div>}
    </div><footer><button className="cancel" onClick={close}>Cancel</button><button className="primary" disabled={(!editing.id&&!form.address.trim())||(form.status==='active'&&!form.device_id&&!form.assigned_to.trim())} onClick={()=>void save()}>{editing.id?'Save changes':'Assign address'}</button></footer></div></div>}
    {addingSubnet&&<div className="modal-backdrop"><div className="resource-modal"><header><div><h2>Add subnet</h2><p>Carve a smaller prefix out of {network.prefix}. It links here automatically — no need to pick a parent.</p></div><button onClick={closeSubnet}><X/></button></header><div className="resource-form">
      <label>Subnet prefix (CIDR)<input autoFocus value={subnetForm.prefix} onChange={e=>setSubnetForm(f=>({...f,prefix:e.target.value}))} placeholder={family==='ipv6'?'2001:db8:1::/64':'177.72.80.0/27'}/></label>
      {subnetForm.prefix&&(subnetContained===true?<p className="cidr-hint ok">✓ Nests under {network.prefix} · {network.name} automatically</p>:subnetContained===false?<p className="cidr-hint warn">Not inside {network.prefix} — this will be created as its own separate network</p>:null)}
      <label>Name<input value={subnetForm.name} onChange={e=>setSubnetForm(f=>({...f,name:e.target.value}))} placeholder="Client access block"/></label>
      <label>Gateway (optional)<input value={subnetForm.gateway} onChange={e=>setSubnetForm(f=>({...f,gateway:e.target.value}))} placeholder="177.72.80.1"/></label>
      <label>Description<textarea value={subnetForm.description} onChange={e=>setSubnetForm(f=>({...f,description:e.target.value}))}/></label>
      {subnetError&&<div className="form-error">{subnetError}</div>}
    </div><footer><button className="cancel" onClick={closeSubnet}>Cancel</button><button className="primary" disabled={!subnetForm.prefix||!subnetForm.name} onClick={()=>void saveSubnet()}>Add subnet</button></footer></div></div>}
  </>;
}

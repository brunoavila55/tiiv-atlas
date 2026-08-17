import {useEffect,useMemo,useState} from 'react';
import {Building2,Check,ExternalLink,MapPin,Pencil,Plus,Server,Users,X} from 'lucide-react';
import {api} from './lib/api';

type Tenant={id:string;name:string;slug:string;created_at:string;sites:number;devices:number;users:number};
type Me={tenant_id:string};
const empty={name:'',slug:''};

export function TenantsPage(){
  const [items,setItems]=useState<Tenant[]>([]);
  const [current,setCurrent]=useState('');
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState<Tenant|null>(null);
  const [form,setForm]=useState(empty);
  const [error,setError]=useState('');
  const totals=useMemo(()=>items.reduce((sum,item)=>({sites:sum.sites+item.sites,devices:sum.devices+item.devices,users:sum.users+item.users}),{sites:0,devices:0,users:0}),[items]);
  const load=()=>Promise.all([api<Tenant[]>('/tenants'),api<Me>('/auth/me')]).then(([tenants,me])=>{setItems(tenants);setCurrent(me.tenant_id)}).catch(reason=>setError(reason.message));
  useEffect(()=>{void load()},[]);

  const startCreate=()=>{setEditing(null);setForm(empty);setError('');setOpen(true)};
  const startEdit=(tenant:Tenant)=>{setEditing(tenant);setForm({name:tenant.name,slug:tenant.slug});setError('');setOpen(true)};
  const save=async()=>{try{if(editing)await api(`/tenants/${editing.id}`,{method:'PUT',body:JSON.stringify(form)});else await api('/tenants',{method:'POST',body:JSON.stringify(form)});setOpen(false);setEditing(null);setForm(empty);await load()}catch(reason){setError(reason instanceof Error?reason.message:'Could not save organization')}};
  const enter=async(tenant:Tenant,target='/dashboard')=>{try{if(tenant.id!==current)await api(`/tenants/${tenant.id}/switch`,{method:'POST'});location.href=target}catch(reason){setError(reason instanceof Error?reason.message:'Could not open organization')}};

  return <>
    <div className="control-hero"><div><span><Building2/></span><div><small>SUPERADMIN CONTROL CENTER</small><h1>Organizations</h1><p>Create companies, review their footprint, manage access, and enter an isolated workspace.</p></div></div><button className="primary" onClick={startCreate}><Plus size={16}/>Add organization</button></div>
    {error&&!open&&<div className="form-error page-error">{error}</div>}
    <div className="control-stats"><article><Building2/><div><strong>{items.length}</strong><small>Organizations</small></div></article><article><MapPin/><div><strong>{totals.sites}</strong><small>Sites</small></div></article><article><Server/><div><strong>{totals.devices}</strong><small>Devices</small></div></article><article><Users/><div><strong>{totals.users}</strong><small>Tenant users</small></div></article></div>
    <section className="panel"><div className="panel-head"><div><h2>Managed organizations</h2><p>Each organization has isolated inventory, IPAM, topology, and users.</p></div></div><div className="tenant-admin-grid">{items.map(tenant=><article key={tenant.id} className={tenant.id===current?'current':''}>
      <div className="tenant-card-head"><span><Building2/></span><div><strong>{tenant.name}</strong><small>{tenant.slug}</small></div>{tenant.id===current&&<em><Check/>Active</em>}</div>
      <div className="tenant-metrics"><span><b>{tenant.sites}</b> Sites</span><span><b>{tenant.devices}</b> Devices</span><span><b>{tenant.users}</b> Users</span></div>
      <small className="tenant-created">Created {new Date(tenant.created_at).toLocaleDateString()}</small>
      <div className="tenant-actions"><button onClick={()=>startEdit(tenant)}><Pencil/>Edit</button><button onClick={()=>void enter(tenant,'/users')}><Users/>Users</button><button className="open-workspace" onClick={()=>void enter(tenant)}><ExternalLink/>Enter workspace</button></div>
    </article>)}</div></section>
    {open&&<div className="modal-backdrop"><div className="resource-modal"><header><div><h2>{editing?'Edit organization':'Add organization'}</h2><p>{editing?'Update the company identity.':'Creates a completely isolated infrastructure workspace.'}</p></div><button onClick={()=>setOpen(false)}><X/></button></header><div className="resource-form"><label>Name<input autoFocus value={form.name} onChange={event=>setForm(currentForm=>({...currentForm,name:event.target.value,slug:editing?currentForm.slug:slugify(event.target.value)}))} placeholder="Acme Datacenter"/></label><label>Slug<input disabled={editing?.slug==='default'} value={form.slug} onChange={event=>setForm(currentForm=>({...currentForm,slug:event.target.value}))}/></label>{error&&<div className="form-error">{error}</div>}</div><footer><button className="cancel" onClick={()=>setOpen(false)}>Cancel</button><button className="primary" disabled={!form.name||!form.slug} onClick={()=>void save()}>{editing?'Save changes':'Create organization'}</button></footer></div></div>}
  </>;
}

const slugify=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

import {useEffect,useMemo,useState} from 'react';
import {Building2,Check,ExternalLink,MapPin,Palette,Pencil,Plus,Server,Trash2,Upload,Users,X} from 'lucide-react';
import {api} from './lib/api';

type Tenant={id:string;name:string;slug:string;created_at:string;sites:number;devices:number;users:number;url:string;brand_name:string;has_logo:boolean;has_favicon:boolean;logo_url?:string;favicon_url?:string};
type Me={tenant_id:string};
const empty={name:'',slug:''};

export function TenantsPage(){
  const [items,setItems]=useState<Tenant[]>([]);
  const [current,setCurrent]=useState('');
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState<Tenant|null>(null);
  const [form,setForm]=useState(empty);
  const [branding,setBranding]=useState<Tenant|null>(null);
  const [brandName,setBrandName]=useState('');
  const [logo,setLogo]=useState<File|null>(null);
  const [favicon,setFavicon]=useState<File|null>(null);
  const [error,setError]=useState('');
  const totals=useMemo(()=>items.reduce((sum,item)=>({sites:sum.sites+item.sites,devices:sum.devices+item.devices,users:sum.users+item.users}),{sites:0,devices:0,users:0}),[items]);
  const load=()=>Promise.all([api<Tenant[]>('/tenants'),api<Me>('/auth/me')]).then(([tenants,me])=>{setItems(tenants);setCurrent(me.tenant_id)}).catch(reason=>setError(reason.message));
  useEffect(()=>{void load()},[]);

  const startCreate=()=>{setEditing(null);setForm(empty);setError('');setOpen(true)};
  const startEdit=(tenant:Tenant)=>{setEditing(tenant);setForm({name:tenant.name,slug:tenant.slug});setError('');setOpen(true)};
  const startBranding=(tenant:Tenant)=>{setBranding(tenant);setBrandName(tenant.brand_name||tenant.name);setLogo(null);setFavicon(null);setError('')};
  const save=async()=>{try{if(editing)await api(`/tenants/${editing.id}`,{method:'PUT',body:JSON.stringify(form)});else await api('/tenants',{method:'POST',body:JSON.stringify(form)});setOpen(false);setEditing(null);setForm(empty);await load()}catch(reason){setError(reason instanceof Error?reason.message:'Could not save organization')}};
  const enter=async(tenant:Tenant,target='/dashboard')=>{try{if(tenant.id!==current)await api(`/tenants/${tenant.id}/switch`,{method:'POST'});location.href=target==='/dashboard'&&tenant.url?tenant.url+target:target}catch(reason){setError(reason instanceof Error?reason.message:'Could not open organization')}};
  const saveBranding=async()=>{if(!branding)return;const data=new FormData();data.append('brand_name',brandName);if(logo)data.append('logo',logo);if(favicon)data.append('favicon',favicon);try{const response=await fetch(`/api/v1/tenants/${branding.id}/branding`,{method:'PUT',credentials:'include',body:data});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body?.error?.message||'Could not update branding');setBranding(null);await load()}catch(reason){setError(reason instanceof Error?reason.message:'Could not update branding')}};
  const removeAsset=async(asset:'logo'|'favicon')=>{if(!branding)return;try{const response=await fetch(`/api/v1/tenants/${branding.id}/branding/${asset}`,{method:'DELETE',credentials:'include'});if(!response.ok)throw new Error('Could not remove asset');setBranding(current=>current?(asset==='logo'?{...current,has_logo:false,logo_url:undefined}:{...current,has_favicon:false,favicon_url:undefined}):null);await load()}catch(reason){setError(reason instanceof Error?reason.message:'Could not remove asset')}};

  return <>
    <div className="control-hero"><div><span><Building2/></span><div><small>SUPERADMIN CONTROL CENTER</small><h1>Organizations</h1><p>Create companies, review their footprint, manage access, and enter an isolated workspace.</p></div></div><button className="primary" onClick={startCreate}><Plus size={16}/>Add organization</button></div>
    {error&&!open&&!branding&&<div className="form-error page-error">{error}</div>}
    <div className="control-stats"><article><Building2/><div><strong>{items.length}</strong><small>Organizations</small></div></article><article><MapPin/><div><strong>{totals.sites}</strong><small>Sites</small></div></article><article><Server/><div><strong>{totals.devices}</strong><small>Devices</small></div></article><article><Users/><div><strong>{totals.users}</strong><small>Tenant users</small></div></article></div>
    <section className="panel"><div className="panel-head"><div><h2>Managed organizations</h2><p>Each organization has isolated inventory, IPAM, topology, and users.</p></div></div><div className="tenant-admin-grid">{items.map(tenant=><article key={tenant.id} className={tenant.id===current?'current':''}>
      <div className="tenant-card-head"><span>{tenant.logo_url?<img src={tenant.logo_url} alt=""/>:<Building2/>}</span><div><strong>{tenant.brand_name||tenant.name}</strong><small>{tenant.slug}</small></div>{tenant.id===current&&<em><Check/>Active</em>}</div>
      {tenant.url&&<a className="tenant-url" href={tenant.url} target="_blank" rel="noreferrer">{tenant.url}</a>}
      <div className="tenant-metrics"><span><b>{tenant.sites}</b> Sites</span><span><b>{tenant.devices}</b> Devices</span><span><b>{tenant.users}</b> Users</span></div>
      <small className="tenant-created">Created {new Date(tenant.created_at).toLocaleDateString()}</small>
      <div className="tenant-actions"><button onClick={()=>startEdit(tenant)}><Pencil/>Edit</button><button onClick={()=>startBranding(tenant)}><Palette/>Branding</button><button onClick={()=>void enter(tenant,'/users')}><Users/>Users</button><button className="open-workspace" onClick={()=>void enter(tenant)}><ExternalLink/>Open portal</button></div>
    </article>)}</div></section>
    {open&&<div className="modal-backdrop"><div className="resource-modal"><header><div><h2>{editing?'Edit organization':'Add organization'}</h2><p>{editing?'Update the company identity and portal subdomain.':'Creates a completely isolated infrastructure workspace.'}</p></div><button onClick={()=>setOpen(false)}><X/></button></header><div className="resource-form"><label>Name<input autoFocus value={form.name} onChange={event=>setForm(currentForm=>({...currentForm,name:event.target.value,slug:editing?currentForm.slug:slugify(event.target.value)}))} placeholder="Acme Datacenter"/></label><label>Portal slug<input value={form.slug} onChange={event=>setForm(currentForm=>({...currentForm,slug:slugify(event.target.value)}))} placeholder="newlife"/></label>{error&&<div className="form-error">{error}</div>}</div><footer><button className="cancel" onClick={()=>setOpen(false)}>Cancel</button><button className="primary" disabled={!form.name||!form.slug} onClick={()=>void save()}>{editing?'Save changes':'Create organization'}</button></footer></div></div>}
    {branding&&<div className="modal-backdrop"><div className="resource-modal branding-modal"><header><div><h2>White label</h2><p>Customize the name, logo, and browser icon for {branding.name}.</p></div><button onClick={()=>setBranding(null)}><X/></button></header><div className="resource-form"><label>Brand name<input autoFocus value={brandName} maxLength={80} onChange={event=>setBrandName(event.target.value)} placeholder={branding.name}/></label><div className="branding-assets"><BrandAsset title="Logo" hint="PNG, JPEG, or WebP · max 2 MB" current={branding.logo_url} file={logo} accept="image/png,image/jpeg,image/webp" onFile={setLogo} onRemove={branding.has_logo?()=>void removeAsset('logo'):undefined}/><BrandAsset title="Favicon" hint="PNG, ICO, JPEG, or WebP · max 256 KB" current={branding.favicon_url} file={favicon} accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/webp,.ico" onFile={setFavicon} onRemove={branding.has_favicon?()=>void removeAsset('favicon'):undefined}/></div>{error&&<div className="form-error">{error}</div>}</div><footer><button className="cancel" onClick={()=>setBranding(null)}>Cancel</button><button className="primary" onClick={()=>void saveBranding()}>Save branding</button></footer></div></div>}
  </>;
}

function BrandAsset({title,hint,current,file,accept,onFile,onRemove}:{title:string;hint:string;current?:string;file:File|null;accept:string;onFile:(file:File|null)=>void;onRemove?:()=>void}){return <section><div className="brand-preview">{current?<img src={current} alt=""/>:<span><Palette/></span>}</div><div><strong>{title}</strong><small>{file?.name||hint}</small><label className="brand-upload"><Upload/>Choose file<input type="file" accept={accept} onChange={event=>onFile(event.target.files?.[0]||null)}/></label>{onRemove&&<button className="brand-remove" type="button" onClick={onRemove}><Trash2/>Remove current</button>}</div></section>}

const slugify=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

import {useEffect,useState} from 'react';
import {Navigate,NavLink,Route,Routes,useLocation,useNavigate} from 'react-router-dom';
import {Activity,Boxes,Building2,Cable,LayoutDashboard,MapPin,Menu,MonitorCog,Moon,Network,PanelsTopLeft as Racks,Search,Server,Settings,Sun,Tags,Users,X} from 'lucide-react';
import {QuickInstall} from './QuickInstall';
import {SitesPage,RoomsPage} from './ResourcePages';
import {IPAddressesPage} from './IPManagement';
import {NetworkAddressesPage} from './NetworkGrid';
import {ManufacturersPage,DeviceModelsPage,VlansPage,PortsPage} from './CatalogPages';
import {LiveTopologyPage} from './LiveTopology';
import {UsersPage} from './UsersPage';
import {AccountMenu} from './AccountMenu';
import {TenantsPage} from './TenantsPage';
import {Dashboard,RackPage,DevicesPage,NetworksPage,ConnectionsPage,PlaceholderPage} from './pages';

const workspaceGroups=[
  {name:'',items:[['Dashboard','/dashboard',LayoutDashboard]]},
  {name:'Infrastructure',items:[['Sites','/sites',MapPin],['Rooms','/rooms',Boxes],['Racks','/racks',Racks],['Devices','/devices',Server]]},
  {name:'Connectivity',items:[['Ports','/ports',Activity],['Connections','/connections',Cable],['Topology','/topology',Network]]},
  {name:'IP Management',items:[['Networks','/networks',Network],['IP Addresses','/ip-addresses',MonitorCog],['VLANs','/vlans',Tags]]},
  {name:'Administration',items:[['Manufacturers','/manufacturers',Settings],['Device Models','/device-models',Boxes],['Organizations','/tenants',Building2],['Users','/users',Users]]}
] as const;
const controlGroups=[{name:'Control center',items:[['Organizations','/tenants',Building2],['Users','/users',Users]]}] as const;

type SessionUser={id:string;name:string;email:string;role:string;tenant_id:string;portal:string;tenant_name?:string;tenant_slug?:string;base_domain?:string};
type TenantSummary={id:string;name:string};
type PortalInfo={kind:'global'|'tenant'|'unscoped';tenant_id:string;tenant_name:string;tenant_slug:string;base_domain:string;brand_name:string;has_logo:boolean;has_favicon:boolean;branding_version:number;logo_url?:string;favicon_url?:string};

function Shell({me,portal}:{me:SessionUser;portal:PortalInfo}){
  const [open,setOpen]=useState(false);
  const [dark,setDark]=useState(false);
  const [install,setInstall]=useState(false);
  const [activeTenant,setActiveTenant]=useState('Organization workspace');
  const nav=useNavigate();
  const location=useLocation();
  const isSuper=me.role==='superadmin';
  const isGlobalSuper=isSuper&&me.portal!=='tenant';
  const controlMode=isGlobalSuper&&['/','/tenants','/users'].includes(location.pathname);
  const groups=controlMode?controlGroups:workspaceGroups;
  const productName=portal.kind==='tenant'?(portal.brand_name||portal.tenant_name):'Tiiv Atlas';

  useEffect(()=>{const show=()=>setInstall(true);window.addEventListener('atlas:quick-add',show);return()=>window.removeEventListener('atlas:quick-add',show)},[]);
  useEffect(()=>{
    if(!isSuper)return;
    fetch('/api/v1/tenants',{credentials:'include'}).then(async response=>{
      if(!response.ok)return;
      const body=await response.json();
      const current=(body.data as TenantSummary[]).find(item=>item.id===me.tenant_id);
      if(current)setActiveTenant(current.name);
    }).catch(()=>undefined);
  },[isSuper,me.tenant_id]);

  return <div className={(dark?'dark ':'')+'role-'+me.role}>{install&&<QuickInstall onClose={()=>setInstall(false)}/>}<div className="app">
    <aside className={open?'sidebar open':'sidebar'}>
      <div className="brand">{portal.kind==='tenant'&&portal.logo_url?<img src={portal.logo_url} alt={productName}/>:<span>T</span>}<div>{productName}<small>{controlMode?'Superadmin Control Center':'Infrastructure Management'}</small></div><button className="mobile-close" onClick={()=>setOpen(false)}><X/></button></div>
      <nav>{groups.map(group=><section key={group.name}><label>{group.name}</label>{group.items.filter(([,path])=>path==='/tenants'?isGlobalSuper:path==='/users'?isSuper:true).map(([name,path,Icon])=><NavLink key={path} to={path} onClick={()=>setOpen(false)} className={({isActive})=>isActive?'active':''}><Icon size={17}/>{name}</NavLink>)}</section>)}</nav>
      {isSuper&&<div className="super-context"><small>{controlMode?'Active organization':'Working in'}</small><strong>{me.tenant_name||activeTenant}</strong>{controlMode?<NavLink to="/dashboard">Open workspace</NavLink>:me.base_domain?<a href={window.location.protocol+'//'+me.base_domain}>Back to control center</a>:<NavLink to="/tenants">Back to control center</NavLink>}</div>}
      <AccountMenu me={me}/>
    </aside>
    <main><header><button className="menu" onClick={()=>setOpen(true)}><Menu/></button>{controlMode?<div className="control-title"><Building2/><div><strong>Superadmin</strong><small>Organizations and access management</small></div></div>:<div className="global-search"><Search size={17}/><input aria-label="Global search" placeholder="Search devices, IPs, racks…" onKeyDown={event=>{if(event.key==='Enter')nav('/devices?q='+encodeURIComponent(event.currentTarget.value))}}/><kbd>⌘ K</kbd></div>}<button className="theme" onClick={()=>setDark(!dark)}>{dark?<Sun/>:<Moon/>}</button></header>
      <div className="content"><Routes>
        <Route path="/" element={isGlobalSuper?<Navigate to="/tenants" replace/>:<Dashboard/>}/><Route path="/dashboard" element={<Dashboard/>}/><Route path="/sites" element={<SitesPage/>}/><Route path="/rooms" element={<RoomsPage/>}/><Route path="/racks" element={<RackPage/>}/><Route path="/devices" element={<DevicesPage/>}/><Route path="/topology" element={<LiveTopologyPage/>}/><Route path="/networks" element={<NetworksPage/>}/><Route path="/networks/:id" element={<NetworkAddressesPage/>}/><Route path="/ip-addresses" element={<IPAddressesPage/>}/><Route path="/connections" element={<ConnectionsPage/>}/><Route path="/ports" element={<PortsPage/>}/><Route path="/vlans" element={<VlansPage/>}/><Route path="/manufacturers" element={<ManufacturersPage/>}/><Route path="/device-models" element={<DeviceModelsPage/>}/><Route path="/users" element={isSuper?<UsersPage/>:<Navigate to="/" replace/>}/><Route path="/tenants" element={isGlobalSuper?<TenantsPage/>:<Navigate to="/" replace/>}/><Route path="*" element={<PlaceholderPage/>}/>
      </Routes></div>
    </main>
  </div></div>;
}

function Login({portal}:{portal:PortalInfo}){
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');
  const productName=portal.kind==='tenant'?(portal.brand_name||portal.tenant_name):'Tiiv Atlas';
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setError('');const response=await fetch('/api/v1/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({Email:email,Password:password})});if(response.ok)location.href='/';else setError('Invalid email or password')};
  return <div className="login-screen"><form onSubmit={submit}>{portal.kind==='tenant'&&portal.logo_url?<img className="login-logo" src={portal.logo_url} alt={productName}/>:<div className="login-brand">T</div>}<h1>{productName}</h1><p>{portal.kind==='tenant'?portal.tenant_name:portal.kind==='global'?'Superadmin Control Center':'Infrastructure Management'}</p><label>Email<input value={email} onChange={event=>setEmail(event.target.value)} type="email"/></label><label>Password<input autoFocus value={password} onChange={event=>setPassword(event.target.value)} type="password" placeholder="Enter your password"/></label>{error&&<div className="form-error">{error}</div>}<button className="primary">Sign in</button></form></div>;
}

export function App(){
  const [me,setMe]=useState<SessionUser|null|undefined>(undefined);
  const [portal,setPortal]=useState<PortalInfo|null|undefined>(undefined);
  useEffect(()=>{void Promise.all([
    fetch('/api/v1/portal').then(async response=>setPortal(response.ok?(await response.json()).data:null)).catch(()=>setPortal(null)),
    fetch('/api/v1/auth/me',{credentials:'include'}).then(async response=>setMe(response.ok?(await response.json()).data:null)).catch(()=>setMe(null))
  ])},[]);
  useEffect(()=>{
    if(!portal)return;
    document.title=portal.kind==='tenant'?(portal.brand_name||portal.tenant_name||'Tiiv Atlas'):'Tiiv Atlas';
    const existing=document.querySelector<HTMLLinkElement>('link[data-atlas-brand-icon]');
    if(portal.kind==='tenant'&&portal.favicon_url){const link=existing??document.createElement('link');link.rel='icon';link.href=portal.favicon_url;link.dataset.atlasBrandIcon='true';if(!existing)document.head.appendChild(link)}else existing?.remove();
  },[portal]);
  if(me===undefined||portal===undefined)return <div className="app-loading">Tiiv Atlas</div>;
  if(portal===null)return <div className="login-screen"><div className="portal-missing"><div className="login-brand">T</div><h1>Organization not found</h1><p>This Tiiv Atlas address is not assigned to an organization.</p></div></div>;
  return me?<Shell me={me} portal={portal}/>:<Login portal={portal}/>;
}

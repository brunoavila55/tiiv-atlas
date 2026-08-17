import {useEffect,useState} from 'react';
import {Navigate,NavLink,Route,Routes,useLocation,useNavigate} from 'react-router-dom';
import {Activity,Boxes,Building2,Cable,LayoutDashboard,MapPin,Menu,MonitorCog,Moon,Network,PanelsTopLeft as Racks,Search,Server,Settings,Sun,Tags,Users,X} from 'lucide-react';
import {QuickInstall} from './QuickInstall';
import {SitesPage,RoomsPage} from './ResourcePages';
import {IPAddressesPage} from './IPManagement';
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

type SessionUser={id:string;name:string;email:string;role:string;tenant_id:string};
type TenantSummary={id:string;name:string};

function Shell({me}:{me:SessionUser}){
  const [open,setOpen]=useState(false);
  const [dark,setDark]=useState(false);
  const [install,setInstall]=useState(false);
  const [activeTenant,setActiveTenant]=useState('Organization workspace');
  const nav=useNavigate();
  const location=useLocation();
  const isSuper=me.role==='superadmin';
  const controlMode=isSuper&&['/','/tenants','/users'].includes(location.pathname);
  const groups=controlMode?controlGroups:workspaceGroups;

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
      <div className="brand"><span>T</span><div>Tiiv Atlas<small>{controlMode?'Superadmin Control Center':'Infrastructure Management'}</small></div><button className="mobile-close" onClick={()=>setOpen(false)}><X/></button></div>
      <nav>{groups.map(group=><section key={group.name}><label>{group.name}</label>{group.items.filter(([,path])=>(!['/users','/tenants'].includes(path)||isSuper)).map(([name,path,Icon])=><NavLink key={path} to={path} onClick={()=>setOpen(false)} className={({isActive})=>isActive?'active':''}><Icon size={17}/>{name}</NavLink>)}</section>)}</nav>
      {isSuper&&<div className="super-context"><small>{controlMode?'Active organization':'Working in'}</small><strong>{activeTenant}</strong>{controlMode?<NavLink to="/dashboard">Open workspace</NavLink>:<NavLink to="/tenants">Back to control center</NavLink>}</div>}
      <AccountMenu me={me}/>
    </aside>
    <main><header><button className="menu" onClick={()=>setOpen(true)}><Menu/></button>{controlMode?<div className="control-title"><Building2/><div><strong>Superadmin</strong><small>Organizations and access management</small></div></div>:<div className="global-search"><Search size={17}/><input aria-label="Global search" placeholder="Search devices, IPs, racks…" onKeyDown={event=>{if(event.key==='Enter')nav('/devices?q='+encodeURIComponent(event.currentTarget.value))}}/><kbd>⌘ K</kbd></div>}<button className="theme" onClick={()=>setDark(!dark)}>{dark?<Sun/>:<Moon/>}</button></header>
      <div className="content"><Routes>
        <Route path="/" element={isSuper?<Navigate to="/tenants" replace/>:<Dashboard/>}/><Route path="/dashboard" element={<Dashboard/>}/><Route path="/sites" element={<SitesPage/>}/><Route path="/rooms" element={<RoomsPage/>}/><Route path="/racks" element={<RackPage/>}/><Route path="/devices" element={<DevicesPage/>}/><Route path="/topology" element={<LiveTopologyPage/>}/><Route path="/networks" element={<NetworksPage/>}/><Route path="/ip-addresses" element={<IPAddressesPage/>}/><Route path="/connections" element={<ConnectionsPage/>}/><Route path="/users" element={isSuper?<UsersPage/>:<Navigate to="/" replace/>}/><Route path="/tenants" element={isSuper?<TenantsPage/>:<Navigate to="/" replace/>}/><Route path="*" element={<PlaceholderPage/>}/>
      </Routes></div>
    </main>
  </div></div>;
}

function Login(){
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setError('');const response=await fetch('/api/v1/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({Email:email,Password:password})});if(response.ok)location.href='/';else setError('Invalid email or password')};
  return <div className="login-screen"><form onSubmit={submit}><div className="login-brand">T</div><h1>Tiiv Atlas</h1><p>Infrastructure Management</p><label>Email<input value={email} onChange={event=>setEmail(event.target.value)} type="email"/></label><label>Password<input autoFocus value={password} onChange={event=>setPassword(event.target.value)} type="password" placeholder="Enter your password"/></label>{error&&<div className="form-error">{error}</div>}<button className="primary">Sign in</button></form></div>;
}

export function App(){
  const [me,setMe]=useState<SessionUser|null|undefined>(undefined);
  useEffect(()=>{fetch('/api/v1/auth/me',{credentials:'include'}).then(async response=>setMe(response.ok?(await response.json()).data:null)).catch(()=>setMe(null))},[]);
  if(me===undefined)return <div className="app-loading">Tiiv Atlas</div>;
  return me?<Shell me={me}/>:<Login/>;
}

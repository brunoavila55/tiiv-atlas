import {useEffect,useRef,useState} from 'react';
import {Navigate,NavLink,Route,Routes,useLocation,useNavigate} from 'react-router-dom';
import {Activity,ArrowRight,Boxes,Building2,Cable,Eye,EyeOff,LayoutDashboard,MapPin,Menu,MonitorCog,Moon,Network,PanelsTopLeft as Racks,Search,Server,Settings,ShieldCheck,Sun,Tags,Users,X} from 'lucide-react';
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
  const [dark,setDark]=useState(true);
  const [install,setInstall]=useState(false);
  const [activeTenant,setActiveTenant]=useState('Organization workspace');
  const nav=useNavigate();
  const location=useLocation();
  const isMaster=me.role==='master';
  const isSuper=me.role==='superadmin';
  const canManageUsers=isMaster||isSuper||me.role==='admin';
  const isGlobalSuper=isMaster&&me.portal!=='tenant';
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
      <nav>{groups.map(group=><section key={group.name}><label>{group.name}</label>{group.items.filter(([,path])=>path==='/tenants'?isGlobalSuper:path==='/users'?canManageUsers:true).map(([name,path,Icon])=><NavLink key={path} to={path} onClick={()=>setOpen(false)} className={({isActive})=>isActive?'active':''}><Icon size={17}/>{name}</NavLink>)}</section>)}</nav>
      {isMaster&&<div className="super-context"><small>{controlMode?'Active organization':'Working in'}</small><strong>{me.tenant_name||activeTenant}</strong>{controlMode?<NavLink to="/dashboard">Open workspace</NavLink>:me.base_domain?<a href={window.location.protocol+'//'+me.base_domain+(window.location.port?':'+window.location.port:'')}>Back to control center</a>:<NavLink to="/tenants">Back to control center</NavLink>}</div>}
      <AccountMenu me={me}/>
    </aside>
    <main><header><button className="menu" onClick={()=>setOpen(true)}><Menu/></button>{controlMode?<div className="control-title"><Building2/><div><strong>Superadmin</strong><small>Organizations and access management</small></div></div>:<div className="global-search"><Search size={17}/><input aria-label="Global search" placeholder="Search devices, IPs, racks…" onKeyDown={event=>{if(event.key==='Enter')nav('/devices?q='+encodeURIComponent(event.currentTarget.value))}}/><kbd>⌘ K</kbd></div>}<button className="theme" onClick={()=>setDark(!dark)}>{dark?<Sun/>:<Moon/>}</button></header>
      <div className="content"><Routes>
        <Route path="/" element={isGlobalSuper?<Navigate to="/tenants" replace/>:<Dashboard/>}/><Route path="/dashboard" element={<Dashboard/>}/><Route path="/sites" element={<SitesPage/>}/><Route path="/rooms" element={<RoomsPage/>}/><Route path="/racks" element={<RackPage/>}/><Route path="/devices" element={<DevicesPage/>}/><Route path="/topology" element={<LiveTopologyPage/>}/><Route path="/networks" element={<NetworksPage/>}/><Route path="/networks/:id" element={<NetworkAddressesPage/>}/><Route path="/ip-addresses" element={<IPAddressesPage/>}/><Route path="/connections" element={<ConnectionsPage/>}/><Route path="/ports" element={<PortsPage/>}/><Route path="/vlans" element={<VlansPage/>}/><Route path="/manufacturers" element={<ManufacturersPage/>}/><Route path="/device-models" element={<DeviceModelsPage/>}/><Route path="/users" element={canManageUsers?<UsersPage/>:<Navigate to="/" replace/>}/><Route path="/tenants" element={isGlobalSuper?<TenantsPage/>:<Navigate to="/" replace/>}/><Route path="*" element={<PlaceholderPage/>}/>
      </Routes></div>
    </main>
  </div></div>;
}

function LoginParticles(){
  const canvasRef=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const context=canvas.getContext('2d');if(!context)return;
    const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame=0,width=0,height=0,dpr=1;
    type Particle={x:number;y:number;vx:number;vy:number;r:number;alpha:number};
    let particles:Particle[]=[];
    const resize=()=>{const box=canvas.getBoundingClientRect();dpr=Math.min(window.devicePixelRatio||1,2);width=box.width;height=box.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);context.setTransform(dpr,0,0,dpr,0,0);const count=Math.max(24,Math.min(58,Math.round(width*height/14000)));particles=Array.from({length:count},()=>({x:Math.random()*width,y:Math.random()*height,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.28,r:.8+Math.random()*1.8,alpha:.18+Math.random()*.34}))};
    const draw=()=>{context.clearRect(0,0,width,height);for(let i=0;i<particles.length;i++){const p=particles[i];if(!reduceMotion){p.x+=p.vx;p.y+=p.vy;if(p.x<-5)p.x=width+5;if(p.x>width+5)p.x=-5;if(p.y<-5)p.y=height+5;if(p.y>height+5)p.y=-5}for(let j=i+1;j<particles.length;j++){const q=particles[j],dx=p.x-q.x,dy=p.y-q.y,distance=Math.hypot(dx,dy);if(distance<135){context.beginPath();context.moveTo(p.x,p.y);context.lineTo(q.x,q.y);context.strokeStyle=`rgba(88,231,95,${(1-distance/135)*.14})`;context.lineWidth=.8;context.stroke()}}context.beginPath();context.arc(p.x,p.y,p.r,0,Math.PI*2);context.fillStyle=`rgba(88,231,95,${p.alpha})`;context.fill()}if(!reduceMotion)frame=requestAnimationFrame(draw)};
    resize();draw();window.addEventListener('resize',resize);return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize)};
  },[]);
  return <canvas ref={canvasRef} className="login-particles" aria-hidden="true"/>;
}

function Login({portal}:{portal:PortalInfo}){
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const productName=portal.kind==='tenant'?(portal.brand_name||portal.tenant_name):'Tiiv Atlas';
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setError('');const response=await fetch('/api/v1/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({Email:email,Password:password})});if(response.ok)location.href='/';else setError('Invalid email or password')};
  return <div className="login-screen"><section className="login-showcase"><LoginParticles/><div className="login-showcase-content"><div className="login-product">{portal.kind==='tenant'&&portal.logo_url?<img className="login-logo" src={portal.logo_url} alt={productName}/>:<div className="login-atlas-mark"><span>T</span><strong>{productName}</strong></div>}</div><div className="login-features"><article><span><Server/></span><div><strong>Infrastructure inventory</strong><small>Devices, racks and sites in one workspace</small></div></article><article><span><Network/></span><div><strong>Live topology</strong><small>Visualize connections across your network</small></div></article><article><span><ShieldCheck/></span><div><strong>IP management</strong><small>Plan networks, VLANs and address allocation</small></div></article></div></div><footer>© 2026 Tiiv Infrastructure Systems</footer></section><section className="login-form-panel"><div className="login-form-wrapper"><div className="login-greeting"><h1>Welcome back</h1><p>Enter your credentials to access the Atlas workspace.</p></div>{error&&<div className="form-error login-error">{error}</div>}<form onSubmit={submit}><label>Email<input autoFocus required autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} type="email" placeholder="Enter your email"/></label><label>Password<div className="login-password-wrap"><input required autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} type={showPassword?'text':'password'} placeholder="Enter your password"/><button type="button" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff/>:<Eye/>}</button></div></label><button className="login-submit" type="submit"><span>Sign in</span><ArrowRight/></button></form><div className="login-form-footer">{productName} <span>Infrastructure Management</span></div></div></section></div>;
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

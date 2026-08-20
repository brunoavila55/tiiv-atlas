export type Device={id:string;name:string;device_type:string;management_ip:string;status:string;rack_position:number;rack_height:number;manufacturer_id?:string;site_id?:string;room_id?:string;rack_id?:string;description?:string;serial_number?:string;asset_tag?:string;created_at?:string;updated_at?:string};
export type Rack={id:string;site_id:string;room_id?:string;name:string;description?:string;rack_units:number;created_at?:string};
export type Site={id:string;name:string;slug:string};
export type NetworkRow={id:string;site_id?:string;prefix:string;name:string;description?:string;gateway?:string};
export type NetworkAddress={address:string;id?:string;device_id?:string;device_name?:string;device_type?:string;assigned_to?:string;dns_name?:string;description?:string;status:string;special?:string;subnet_id?:string;subnet_prefix?:string;subnet_name?:string};
export type RelatedNetwork={id:string;prefix:string;name:string};
export type ConnectionEdge={cable_id:string;device_a_id:string;device_a_name:string;device_a_type:string;device_a_ip:string;device_a_addresses:string;device_a_status:string;port_a:string;device_b_id:string;device_b_name:string;device_b_type:string;device_b_ip:string;device_b_addresses:string;device_b_status:string;port_b:string;cable_type:string;label:string};
export type Port={id:string;device_id:string;name:string;type:string};
export async function api<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch('/api/v1'+path,{credentials:'include',headers:{'Content-Type':'application/json',...init?.headers},...init});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body?.error?.message??'Request failed');return body.data as T}


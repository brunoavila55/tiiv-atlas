export type Device={id:string;name:string;device_type:string;management_ip:string;status:string;rack_position:number;rack_height:number;manufacturer_id?:string};
export async function api<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch('/api/v1'+path,{credentials:'include',headers:{'Content-Type':'application/json',...init?.headers},...init});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body?.error?.message??'Request failed');return body.data as T}


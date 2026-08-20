// Pure client-side CIDR helpers (IPv4 and IPv6) used to preview network
// nesting before save — the backend is the source of truth (it re-derives
// containment from Postgres's cidr type, which is dual-stack natively on
// every read), this is purely an instant UI hint. IPv6 addresses need a
// 128-bit integer, so this uses BigInt throughout rather than plain numbers.
export type Cidr={family:'ipv4'|'ipv6';base:bigint;bits:number};

function parseIPv4Address(addr:string):bigint|null{
  const match=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if(!match)return null;
  const octets=[1,2,3,4].map(i=>parseInt(match[i],10));
  if(octets.some(o=>o<0||o>255))return null;
  return octets.reduce((acc,o)=>acc*256n+BigInt(o),0n);
}

// Handles "::" compression (at most once) and expands to 8 groups of 16
// bits. Does not handle embedded IPv4-mapped notation (e.g. "::ffff:1.2.3.4")
// — that's rare enough for infrastructure documentation that it's fine to
// just fall through to "can't parse yet, withhold the hint" for it.
function parseIPv6Address(addr:string):bigint|null{
  if(addr==='')return null;
  const doubleColonCount=addr.split('::').length-1;
  if(doubleColonCount>1)return null;
  const hasDoubleColon=doubleColonCount===1;
  const sides=hasDoubleColon?addr.split('::'):[addr];
  const left=(sides[0]??'').split(':').filter(s=>s!=='');
  const right=(sides[1]??'').split(':').filter(s=>s!=='');
  const groupCount=left.length+right.length;
  if(hasDoubleColon?groupCount>7:groupCount!==8)return null;
  const filled=[...left,...Array(8-groupCount).fill('0'),...right];
  if(filled.length!==8)return null;
  let value=0n;
  for(const group of filled){
    if(!/^[0-9a-fA-F]{1,4}$/.test(group))return null;
    value=(value<<16n)|BigInt(parseInt(group,16));
  }
  return value;
}

export function parseCIDR(value:string):Cidr|null{
  const trimmed=value.trim();
  const slash=trimmed.lastIndexOf('/');
  if(slash<0)return null;
  const addr=trimmed.slice(0,slash);
  const bitsPart=trimmed.slice(slash+1);
  if(!/^\d{1,3}$/.test(bitsPart))return null;
  const bits=parseInt(bitsPart,10);
  if(addr.includes(':')){
    if(bits<0||bits>128)return null;
    const base=parseIPv6Address(addr);
    return base===null?null:{family:'ipv6',base,bits};
  }
  if(bits<0||bits>32)return null;
  const base=parseIPv4Address(addr);
  return base===null?null:{family:'ipv4',base,bits};
}

export function isIPv6Prefix(value:string):boolean{
  return value.includes(':');
}

// true/false once both sides parse as the same address family; null when
// either prefix isn't valid yet (e.g. the user is still typing), or the two
// are different families (which can never nest), so callers can withhold
// the hint rather than show a misleading answer.
export function cidrContains(parent:string,child:string):boolean|null{
  const p=parseCIDR(parent),c=parseCIDR(child);
  if(!p||!c)return null;
  if(p.family!==c.family)return false;
  if(c.bits<p.bits)return false;
  const width=p.family==='ipv4'?32:128;
  const parentSize=2n**BigInt(width-p.bits);
  const parentStart=p.base-(p.base%parentSize);
  const childSize=2n**BigInt(width-c.bits);
  const childStart=c.base-(c.base%childSize);
  return childStart>=parentStart&&childStart<parentStart+parentSize;
}

import {useEffect,useRef,useState} from 'react';
import {MoreHorizontal} from 'lucide-react';

export type RowMenuItem = {label:string; onClick:()=>void; danger?:boolean};

// Reusable "kebab" (three dots) row action menu. Renders its dropdown with
// position:fixed, computed from the trigger button's own bounding box, so it
// is never clipped by an ancestor table wrapper's overflow:auto (a real risk
// for a menu that lives inside a scrollable <table>).
export function RowMenu({items}:{items:RowMenuItem[]}){
  const [open,setOpen]=useState(false);
  const [pos,setPos]=useState({top:0,left:0});
  const buttonRef=useRef<HTMLButtonElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if(!open)return;
    // Only close on an outside mousedown. Checking both the trigger AND the
    // menu itself is essential here: if we closed on any mousedown outside
    // the trigger, clicking a menu item would unmount the menu (and the very
    // button being clicked) before the browser's follow-up "click" event has
    // a chance to fire, so the item's onClick would silently never run.
    const onPointerDown=(event:MouseEvent)=>{
      const target=event.target as Node;
      if(buttonRef.current?.contains(target)||menuRef.current?.contains(target))return;
      setOpen(false);
    };
    const onDismiss=()=>setOpen(false);
    document.addEventListener('mousedown',onPointerDown);
    window.addEventListener('scroll',onDismiss,true);
    window.addEventListener('resize',onDismiss);
    return()=>{
      document.removeEventListener('mousedown',onPointerDown);
      window.removeEventListener('scroll',onDismiss,true);
      window.removeEventListener('resize',onDismiss);
    };
  },[open]);

  const toggle=()=>{
    if(!open&&buttonRef.current){
      const rect=buttonRef.current.getBoundingClientRect();
      const width=170;
      setPos({top:rect.bottom+6,left:Math.min(Math.max(8,rect.right-width),window.innerWidth-width-8)});
    }
    setOpen(value=>!value);
  };

  if(items.length===0)return null;

  return <>
    <button type="button" className="row-menu-trigger" ref={buttonRef} onClick={toggle} aria-haspopup="menu" aria-expanded={open} title="More actions">
      <MoreHorizontal size={16}/>
    </button>
    {open&&<div className="row-menu" role="menu" ref={menuRef} style={{top:pos.top,left:pos.left}}>
      {items.map(item=><button key={item.label} type="button" role="menuitem" className={item.danger?'danger':''} onClick={()=>{setOpen(false);item.onClick()}}>{item.label}</button>)}
    </div>}
  </>;
}

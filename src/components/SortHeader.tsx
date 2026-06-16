import type { ReactNode } from "react";
import type { SortDirection } from "../types/ui";

export function SortHeader<T extends string>({label,sortKey,activeKey,direction,onSort,children}:{label:string;sortKey:T;activeKey:T;direction:SortDirection;onSort:(key:T)=>void;children?:ReactNode}){
  const active=activeKey===sortKey;
  return <th aria-sort={active?(direction==="asc"?"ascending":"descending"):"none"}><button type="button" className={`sort-header ${active?"active":""}`} onClick={()=>onSort(sortKey)}><span>{children??label}</span><i aria-hidden="true">{active?(direction==="asc"?"↑":"↓"):"↕"}</i></button></th>;
}

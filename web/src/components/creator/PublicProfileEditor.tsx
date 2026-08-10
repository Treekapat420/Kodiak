"use client";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

type Meta = { displayName:string; username:string; bio:string; avatarUrl:string; xUrl:string; telegramUrl:string; websiteUrl:string };
export function PublicProfileEditor({ wallet, initial, onSaved }: { wallet:string; initial:Meta; onSaved:(meta:Meta)=>void }) {
  const { publicKey, signMessage } = useWallet();
  const owns = publicKey?.toBase58() === wallet;
  const [editing,setEditing]=useState(false); const [form,setForm]=useState(initial); const [status,setStatus]=useState("");
  if (!owns) return null;
  const field=(key:keyof Meta,label:string,placeholder:string)=><label className="grid gap-2 text-sm font-bold text-zinc-300"><span>{label}</span><input value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))} placeholder={placeholder} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-normal text-white outline-none focus:border-emerald-400/50" /></label>;
  async function save(){
    if(!signMessage){setStatus("This wallet does not support message signing.");return;}
    try { setStatus("Waiting for wallet signature...");
      const n=await fetch(`/api/creator/${encodeURIComponent(wallet)}/profile/nonce`,{method:"POST",cache:"no-store"}); const nd=await n.json(); if(!n.ok) throw new Error(nd.error||"Unable to authorize edit.");
      const sig=await signMessage(new TextEncoder().encode(nd.message));
      const signature=btoa(String.fromCharCode(...sig));
      setStatus("Saving profile...");
      const r=await fetch(`/api/creator/${encodeURIComponent(wallet)}/profile`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,nonce:nd.nonce,message:nd.message,signature})}); const d=await r.json(); if(!r.ok) throw new Error(d.error||"Unable to save profile.");
      setForm(d.profile); onSaved(d.profile); setEditing(false); setStatus("Profile saved.");
    } catch(e){setStatus(e instanceof Error?e.message:"Unable to save profile.");}
  }
  if(!editing) return <div className="mt-5"><button onClick={()=>setEditing(true)} className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black">Edit public profile</button>{status&&<p className="mt-2 text-xs text-zinc-500">{status}</p>}</div>;
  return <section className="mt-6 rounded-2xl border border-emerald-400/20 bg-black/30 p-5"><div className="grid gap-4 sm:grid-cols-2">{field("displayName","Display name","Kodiak creator")}{field("username","Username","creator_name")}{field("avatarUrl","Profile picture URL","https://...")}{field("websiteUrl","Website","https://...")}{field("xUrl","X profile","https://x.com/...")}{field("telegramUrl","Telegram","https://t.me/...")}<label className="grid gap-2 text-sm font-bold text-zinc-300 sm:col-span-2"><span>Bio</span><textarea maxLength={280} rows={4} value={form.bio} onChange={e=>setForm(v=>({...v,bio:e.target.value}))} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-normal text-white outline-none focus:border-emerald-400/50" /></label></div><div className="mt-4 flex gap-3"><button onClick={()=>void save()} className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black">Sign & save</button><button onClick={()=>setEditing(false)} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black">Cancel</button></div>{status&&<p className="mt-3 text-xs text-zinc-400">{status}</p>}</section>;
}

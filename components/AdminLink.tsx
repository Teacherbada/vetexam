"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function AdminLink(){const {data:session}=authClient.useSession();const [isAdmin,setIsAdmin]=useState(false);useEffect(()=>{if(!session?.user?.id){setIsAdmin(false);return}fetch("/api/admin/status",{cache:"no-store"}).then(response=>response.ok?response.json():null).then(data=>setIsAdmin(data?.isAdmin===true)).catch(()=>setIsAdmin(false))},[session?.user?.id]);return isAdmin?<Link href="/admin" className="fixed bottom-5 left-5 z-50 rounded-full bg-indigo-700 px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-600">管理後台</Link>:null}

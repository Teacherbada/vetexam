"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { readAdminStatus } from '@/lib/admin-status-client';

export default function AdminLink() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const [status, setStatus] = useState<{ owner: string; allowed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    if (userId) void readAdminStatus(userId).then(allowed => { if (active) setStatus({ owner: userId, allowed }); });
    return () => { active = false; };
  }, [userId]);
  return userId && status?.owner === userId && status.allowed ? <Link href="/admin" className="fixed bottom-5 left-5 z-50 rounded-full bg-indigo-700 px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-600">管理後台</Link> : null;
}

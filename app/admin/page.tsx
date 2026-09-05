import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AdminDashboard from "./AdminDashboard";

export default async function AdminPage(){const session=await auth.api.getSession({headers:await headers()});if(!session?.user?.id)redirect("/login");if(session.user.id!==process.env.ADMIN_USER_ID?.trim())redirect("/");return <AdminDashboard/>}

import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-page";
export default async function FeedbackPage() {
  await requireAdminPage();
  redirect("/admin/reports");
}

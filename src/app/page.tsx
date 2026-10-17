import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (session.isSuperAdmin) redirect("/super-admin");
  redirect(session.role === "admin" ? "/dashboard" : "/open-queue");
}
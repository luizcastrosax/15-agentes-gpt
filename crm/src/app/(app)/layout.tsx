import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { DataProvider } from "@/components/DataProvider";
import { Shell } from "@/components/Shell";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <ToastProvider>
      <DataProvider>
        <Shell>{children}</Shell>
      </DataProvider>
    </ToastProvider>
  );
}

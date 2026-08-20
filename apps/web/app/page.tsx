import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MarketingPage } from "@/components/marketing/MarketingPage";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return <MarketingPage />;
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <h1 className="text-xl font-bold text-gray-900">🥗 Meal Planner</h1>
          <span className="text-sm text-gray-500 truncate max-w-[180px]">
            {user.email}
          </span>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8 space-y-4">
        <Link href="/planner" className="block">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 active:bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-800 mb-1">
              This Week
            </h2>
            <p className="text-gray-400 text-sm">Tap to plan your week →</p>
          </div>
        </Link>

        <div className="grid grid-cols-2 gap-4">
          <Link href="/recipes" className="block">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 active:bg-gray-50">
              <div className="text-2xl mb-2">📚</div>
              <h3 className="font-semibold text-gray-800">Library</h3>
              <p className="text-xs text-gray-400 mt-0.5">Recipes</p>
            </div>
          </Link>
          <Link href="/shopping" className="block">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 active:bg-gray-50">
              <div className="text-2xl mb-2">🛒</div>
              <h3 className="font-semibold text-gray-800">Shopping</h3>
              <p className="text-xs text-gray-400 mt-0.5">This week&apos;s list</p>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}

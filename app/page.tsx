import { redirect } from "next/navigation";
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
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">
            This Week
          </h2>
          <p className="text-gray-400 text-sm">No meals planned yet.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="text-2xl mb-2">📚</div>
            <h3 className="font-semibold text-gray-800">Library</h3>
            <p className="text-xs text-gray-400 mt-0.5">0 recipes</p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="text-2xl mb-2">🛒</div>
            <h3 className="font-semibold text-gray-800">Shopping</h3>
            <p className="text-xs text-gray-400 mt-0.5">No list yet</p>
          </div>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
          <p className="text-sm text-green-800 font-medium">
            ✅ You&apos;re signed in and ready to go.
          </p>
          <p className="text-xs text-green-600 mt-1">
            More features coming in the next checkpoint.
          </p>
        </div>
      </main>
    </div>
  );
}

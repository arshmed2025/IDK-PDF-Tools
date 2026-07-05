import { Capacitor } from '@capacitor/core'

export default function PrivacyBadge() {
  // Only show this footer in the native app shell
  if (!Capacitor.isNativePlatform()) return null

  return (
    <div className="mt-16 pt-8 border-t border-gray-100 dark:border-zinc-900 flex flex-col items-center gap-6 animate-in fade-in duration-700">
      <div className="flex items-center gap-3 px-4 py-2 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-full border border-emerald-100 dark:border-emerald-900/20">
         <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
         <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Secure Offline Session Active</span>
      </div>
    </div>
  )
}

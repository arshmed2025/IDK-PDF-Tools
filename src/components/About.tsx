/**
 * IDK PDF Tools - About & Protocol Specification
 */

import { useState } from 'react'
import {
  Code as CodeIcon,
  Cpu as CpuIcon,
  Shield as ShieldIcon,
  ChevronDown as ChevronDownIcon,
  ServerOff as ServerOffIcon,
  HardDrive as DiskIcon,
  EyeOff as PrivacyIcon,
  Github as GHIcon,
  GitFork as GitForkIcon,
  Star as StarIcon
} from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { NativeToolLayout } from './tools/shared/NativeToolLayout'
import { AppLogo } from './Logo'
import { ViewMode } from '../types'

// --- UI COMPONENTS ---
const SpecItem = ({ title, icon: Icon, children, defaultOpen = false }: { title: string, icon: any, children: React.ReactNode, defaultOpen?: boolean }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-gray-100 dark:border-zinc-800 last:border-0 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-6 flex items-center justify-between text-left group transition-all"
      >
        <div className="flex items-center gap-5">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500 ${isOpen ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20' : 'bg-gray-50 dark:bg-zinc-900 text-gray-400 group-hover:text-sky-500 group-hover:bg-sky-50 dark:group-hover:bg-sky-900/10'}`}>
            <Icon size={20} strokeWidth={2.5} />
          </div>
          <h4 className="font-black text-xs md:text-sm uppercase tracking-[0.2em] text-gray-900 dark:text-white transition-colors">{title}</h4>
        </div>
        <div className={`p-2 rounded-full transition-all ${isOpen ? 'bg-sky-50 dark:bg-sky-900/20 text-sky-500' : 'text-gray-300'}`}>
          <ChevronDownIcon size={18} className={`transition-transform duration-500 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {isOpen && (
        <div className="pb-8 pl-16 pr-6 text-sm md:text-base text-gray-500 dark:text-zinc-400 font-medium leading-relaxed animate-in slide-in-from-top-4 duration-500">
          {children}
        </div>
      )}
    </div>
  )
}

// --- WEB VERSION ---
const AboutWeb = () => {
  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-black text-gray-900 dark:text-zinc-100 selection:bg-sky-500 selection:text-white pb-24">

      {/* 1. Impact Hero */}
      <section className="relative pt-20 pb-12 px-6 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(circle_at_center,rgba(14,165,233,0.05),transparent_60%)] pointer-events-none" />
        <div className="max-w-5xl mx-auto text-center relative z-10">
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter dark:text-white mb-6 leading-[0.9] animate-in fade-in slide-in-from-bottom-4 duration-700">
            Privacy is a <br/>
            <span className="text-sky-500 font-black">Human Right.</span>
          </h1>
          <p className="text-lg md:text-xl text-gray-500 dark:text-zinc-400 max-w-2xl mx-auto leading-relaxed font-medium animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
            IDK PDF Tools is an absolute document engine. No servers, no tracking, no compromises. We transform your browser into a self-contained document laboratory.
          </p>
        </div>
      </section>

      {/* 2. Deep Specification */}
      <section className="max-w-6xl mx-auto px-6 mb-20 pt-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">

          {/* Narrative Column */}
          <div className="lg:col-span-5 space-y-8">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-zinc-100 dark:bg-white/5 rounded-md text-[9px] font-black uppercase tracking-widest text-gray-400 border border-gray-200/50 dark:border-white/5">
               Technical Manifesto
            </div>
            <h2 className="text-3xl font-black tracking-tighter dark:text-white leading-[1.1]">
              Architecture of <br/>
              <span className="text-sky-500">Absolute Sovereignty.</span>
            </h2>
            <p className="text-gray-500 dark:text-zinc-400 text-sm font-medium leading-relaxed">
              IDK PDF Tools rejects the trade-off between convenience and privacy. It runs where the user is, ensuring your sensitive data never crosses a network boundary.
            </p>
            <div className="p-6 bg-white dark:bg-zinc-900 rounded-[2rem] border border-gray-100 dark:border-white/5 shadow-sm">
               <h4 className="font-black text-[10px] uppercase tracking-widest text-emerald-500 mb-3 flex items-center gap-2">
                  <ServerOffIcon size={14} /> Zero Infrastructure
               </h4>
               <p className="text-xs text-gray-500 dark:text-zinc-400 font-medium leading-relaxed">
                  No backend. No databases. No file caches. IDK PDF Tools is a static distribution of code that activates your browser's existing power.
               </p>
            </div>
          </div>

          {/* Accordion Column */}
          <div className="lg:col-span-7 bg-white dark:bg-zinc-900 rounded-[2.5rem] p-2 md:p-6 border border-gray-100 dark:border-white/5 shadow-sm">
             <SpecItem title="How it Works" icon={CpuIcon} defaultOpen={true}>
                Every action is executed locally on your device's CPU. Using high-performance <span className="text-sky-500 font-bold">Web Workers</span> and <span className="text-sky-500 font-bold">WebAssembly</span>, IDK PDF Tools loads your PDF into a sandboxed environment within your browser tab.
             </SpecItem>

             <SpecItem title="Data Lifecycle" icon={PrivacyIcon}>
                Your documents live exclusively in your browser's <span className="text-sky-500 font-bold">volatile memory (RAM)</span>. No persistent storage or cookies are used for your file content. Once the tab is closed, the data is destroyed.
             </SpecItem>

             <SpecItem title="Deep Metadata Clean" icon={DiskIcon}>
                The "Deep Clean" metadata protocol purges identifying strings like Producer, Creator, and XMP metadata that standard editors leave behind, ensuring your files are truly anonymous.
             </SpecItem>

             <SpecItem title="Radical Transparency" icon={CodeIcon}>
                IDK PDF Tools runs entirely on open web technology, so every operation is auditable and nothing is hidden behind a server.
             </SpecItem>

             <SpecItem title="Privacy Nodes" icon={ShieldIcon}>
                By processing documents on-device, every user acts as their own "Privacy Node." There is no central point of failure and no surveillance capability.
             </SpecItem>
          </div>

        </div>
      </section>

      {/* 3. Credits & Attribution */}
      <section className="max-w-6xl mx-auto px-6 mb-20">
        <div className="bg-white dark:bg-zinc-900 rounded-[2.5rem] p-8 md:p-10 border border-gray-100 dark:border-white/5 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <GitForkIcon size={16} className="text-gray-400" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Credits &amp; Attribution</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Upstream */}
            <div className="p-6 rounded-[1.5rem] bg-gray-50 dark:bg-black/40 border border-gray-100 dark:border-white/5">
              <h4 className="font-black text-sm dark:text-white mb-2">Core PDF Toolkit</h4>
              <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed mb-4">
                Merge, Split, Compress, Protect, Unlock, Rotate, Rearrange, Watermark, Page Numbers,
                Metadata, Signature, Grayscale, Repair, PDF&nbsp;↔&nbsp;Image and PDF&nbsp;to&nbsp;Text are
                adapted from the open-source project{' '}
                <a
                  href="https://github.com/potatameister/PaperKnife"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-500 font-bold underline underline-offset-2 hover:text-sky-600"
                >
                  PaperKnife
                </a>{' '}
                by potatameister, used under the <span className="font-bold">GNU AGPL v3</span> license.
              </p>
              <a
                href="https://github.com/potatameister/PaperKnife"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-sky-500 transition-colors"
              >
                <GHIcon size={14} /> View upstream source
              </a>
            </div>

            {/* Ours */}
            <div className="p-6 rounded-[1.5rem] bg-amber-50/60 dark:bg-amber-900/10 border border-amber-200/60 dark:border-amber-900/30">
              <div className="flex items-center gap-2 mb-2">
                <StarIcon size={12} className="text-amber-500 fill-current" />
                <h4 className="font-black text-sm text-amber-700 dark:text-amber-400">My Tools</h4>
              </div>
              <p className="text-xs text-gray-600 dark:text-zinc-400 leading-relaxed mb-3">
                Three tools were added here rather than inherited:
              </p>
              <ul className="space-y-2 text-xs text-gray-600 dark:text-zinc-400 leading-relaxed">
                <li>
                  <span className="font-bold text-gray-900 dark:text-white">Study Sheet Builder</span>{' '}
                  <StarIcon size={9} className="inline text-amber-500 fill-current" /> — written from scratch.
                </li>
                <li>
                  <span className="font-bold text-gray-900 dark:text-white">Extract Images</span>{' '}
                  <StarIcon size={9} className="inline text-amber-500 fill-current" /> — upstream shipped a tool
                  of the same name; this is a ground-up rewrite using our own extractor.
                </li>
                <li>
                  <span className="font-bold text-gray-900 dark:text-white">Office to PDF</span> — written from scratch.
                </li>
              </ul>
              <p className="text-[10px] text-gray-500 dark:text-zinc-500 leading-relaxed mt-3">
                <StarIcon size={9} className="inline text-amber-500 fill-current" /> = marked
                <span className="font-bold"> Dev&apos;s Choice</span> on the dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Footer mark */}
      <section className="max-w-4xl mx-auto px-6 text-center border-t border-gray-100 dark:border-zinc-900 pt-16">
        <div className="opacity-20">
          <AppLogo size={32} iconColor="#0EA5E9" partColor="currentColor" className="mx-auto mb-4" />
          <p className="text-[9px] font-black uppercase tracking-[0.6em] text-gray-400">IDK PDF Tools</p>
        </div>
      </section>

    </div>
  )
}


// --- MOBILE VERSION ---
const AboutMobile = () => {
  return (
    <NativeToolLayout title="Protocol" description="System Internals" actions={null}>
      <div className="px-4 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700 space-y-4">

        {/* 1. App Identity */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] p-6 border border-gray-100 dark:border-white/5 shadow-sm flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-gray-50 dark:bg-black rounded-[1.5rem] flex items-center justify-center shadow-inner mb-4">
            <AppLogo size={40} iconColor="#0EA5E9" partColor="currentColor" />
          </div>
          <h2 className="text-2xl font-black tracking-tighter dark:text-white leading-none mb-1">IDK PDF Tools</h2>
          <p className="text-[9px] font-black uppercase tracking-widest text-sky-500">v1 • Absolute Privacy</p>
        </div>

        {/* 2. Explainer Protocol */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] p-2 border border-gray-100 dark:border-white/5 shadow-sm overflow-hidden">
           <div className="p-4 border-b border-gray-50 dark:border-white/5">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">System Internal Specification</h3>
           </div>

           <div className="divide-y divide-gray-50 dark:divide-white/5 px-2">
              <SpecItem title="How it Works" icon={CpuIcon}>
                Every action you perform—merging, splitting, or encrypting—happens locally on your device's CPU, powered by <span className="text-sky-500 font-bold">pdf-lib</span> and <span className="text-sky-500 font-bold">WebAssembly</span>. No data ever leaves your hardware.
              </SpecItem>

              <SpecItem title="Data Privacy" icon={PrivacyIcon}>
                Your files are loaded into the app's <span className="text-sky-500 font-bold">volatile memory (RAM)</span> only during your active session. Once you navigate away, the processed document is permanently purged.
              </SpecItem>

              <SpecItem title="Deep Metadata Clean" icon={DiskIcon}>
                Most tools leave digital breadcrumbs in the PDF metadata. The "Deep Clean" protocol sanitizes every document, purging Producer, Creator, and XMP metadata to ensure absolute anonymity.
              </SpecItem>

              <SpecItem title="Zero Infrastructure" icon={ServerOffIcon}>
                A Zero-Server Architecture: no backend, no database, no cloud. Your device is the laboratory, and your documents stay in your hands alone.
              </SpecItem>
           </div>
        </div>

      </div>
    </NativeToolLayout>
  )
}

// --- MAIN ROUTER ---
export default function About({ viewMode }: { viewMode?: ViewMode }) {
  const isMobile = viewMode === 'android' || (viewMode === undefined && Capacitor.isNativePlatform())
  return isMobile ? <AboutMobile /> : <AboutWeb />
}

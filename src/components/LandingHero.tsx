import React, { useState } from "react";
import { BoltIcon, CheckIcon, ExternalLinkIcon, HammerIcon, LeafIcon, LockIcon, PackageIcon, PaletteIcon, SearchIcon, SnowflakeIcon, SparklesIcon, WrenchIcon } from "./UiIcons";

interface LandingHeroProps {
  onStartRequest: (initialPrompt?: string, category?: string) => void;
  onOpenAuth: () => void;
}

const CATEGORIES = [
  { id: "electrical", label: "Electrical", icon: BoltIcon, prompt: "Need electrical wiring or fixture repair" },
  { id: "plumbing", label: "Plumbing", icon: WrenchIcon, prompt: "Fix a leaking pipe or install a faucet" },
  { id: "cleaning", label: "House Cleaning", icon: SparklesIcon, prompt: "Deep clean a residential apartment" },
  { id: "handyman", label: "Handyman", icon: HammerIcon, prompt: "Mount a TV and assemble furniture" },
  { id: "moving", label: "Moving", icon: PackageIcon, prompt: "Help moving apartment furniture" },
  { id: "painting", label: "Painting", icon: PaletteIcon, prompt: "Interior room painting" },
  { id: "hvac", label: "AC & Heating", icon: SnowflakeIcon, prompt: "Air conditioning repair and servicing" },
  { id: "landscaping", label: "Landscaping", icon: LeafIcon, prompt: "Lawn care and yard cleanup" },
];

export function LandingHero({ onStartRequest }: LandingHeroProps) {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    onStartRequest(prompt);
  };

  const handleCategorySelect = (cat: typeof CATEGORIES[0]) => {
    onStartRequest(cat.prompt, cat.id);
  };

  return (
    <div className="w-full bg-white flex flex-col">
      {/* 1. Main Hero Section */}
      <section className="bg-gradient-to-b from-stone-50 via-stone-50/50 to-white pt-8 pb-14 sm:pt-14 sm:pb-20 border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            {/* Left Hero Content */}
            <div className="lg:col-span-7 space-y-6">
              <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-[1.12]">
                Get help with your home project
              </h1>

              <p className="text-base sm:text-lg text-gray-600 leading-relaxed max-w-xl">
                Findor checks local licensed providers, gathers verified quotes, and brings you clear options without the endless phone tag.
              </p>

              {/* Dominant Problem / Search Bar */}
              <form onSubmit={handleSubmit} className="mt-2">
                <div className="rounded-2xl bg-white p-2 sm:p-3 shadow-lg shadow-gray-200/70 border-2 border-emerald-600/30 focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-100 transition-all flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="flex items-center gap-3 px-3 py-2 flex-1">
                    <SearchIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Describe what you need help with (e.g. Electrical wiring repair in Brooklyn)..."
                      className="w-full border-none p-0 text-sm sm:text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 bg-transparent"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!prompt.trim()}
                    className="px-6 py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-100 disabled:text-gray-400 text-white text-sm font-bold rounded-xl shadow-sm transition-all"
                  >
                    Get started
                  </button>
                </div>
              </form>

              {/* Category Shortcuts */}
              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
                  Popular services
                </span>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.slice(0, 6).map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => handleCategorySelect(cat)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-stone-50 border border-gray-200 text-xs font-semibold text-gray-700 hover:text-gray-900 shadow-sm transition-all"
                    >
                      <cat.icon className="w-4 h-4" />
                      <span>{cat.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Hero Image */}
            <div className="lg:col-span-5">
              <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-stone-300/60 border border-stone-200/80 bg-stone-100 aspect-[4/3] sm:aspect-[16/11]">
                <img
                  src="/images/findor_hero.jpg"
                  alt="Professional tradesperson assisting homeowner"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 text-white text-xs">
                  <div className="flex items-center gap-2 bg-black/60 backdrop-blur px-3 py-2 rounded-xl">
                    <CheckIcon className="w-4 h-4 text-emerald-400" />
                    <span>Direct quotes from verified local professionals</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Popular Categories Visual Grid */}
      <section className="py-12 sm:py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8">
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
              Explore services
            </h2>
            <p className="text-sm text-gray-500">
              Select a category to start your project with verified local businesses.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategorySelect(cat)}
                className="p-4 rounded-2xl border border-gray-200 hover:border-emerald-600 bg-white hover:bg-stone-50/60 text-left transition-all group flex flex-col justify-between space-y-3"
              >
                <div className="w-10 h-10 rounded-xl bg-stone-100 group-hover:bg-emerald-50 text-emerald-800 flex items-center justify-center text-xl transition-colors">
                  <cat.icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 group-hover:text-emerald-800 transition-colors">
                    {cat.label}
                  </h3>
                  <p className="inline-flex items-center gap-1 text-xs text-gray-400 mt-0.5">Find local pros <ExternalLinkIcon className="w-3.5 h-3.5" /></p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Simple 3-Step Guide */}
      <section className="py-12 sm:py-16 bg-stone-50/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              How Findor works
            </h2>
            <p className="text-sm text-gray-600">
              We do the legwork so you get transparent local service estimates without phone tag.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-white border border-gray-200 shadow-sm space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                1
              </div>
              <h3 className="text-base font-bold text-gray-900">1. Describe your project</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Tell us what you need in plain English, your location, and when you’d like the work done.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-gray-200 shadow-sm space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                2
              </div>
              <h3 className="text-base font-bold text-gray-900">2. Findor contacts verified pros</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                We search legitimate local businesses and send outreach inquiries directly to verified email routes.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-gray-200 shadow-sm space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                3
              </div>
              <h3 className="text-base font-bold text-gray-900">3. Review options & decide</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Compare structured prices, availability, and included scope side-by-side before committing.
              </p>
            </div>
          </div>

          {/* Privacy Guarantee */}
          <div className="p-4 rounded-2xl bg-white border border-emerald-200/80 flex items-center gap-3 max-w-2xl mx-auto shadow-sm">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm flex-shrink-0">
              <LockIcon className="w-4 h-4" />
            </div>
            <p className="text-xs text-gray-600">
              <strong className="text-gray-900">Your privacy comes first: </strong>
              Your street address is never shared during discovery or initial inquiries.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

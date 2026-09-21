interface HeaderProps {
  isAuthenticated: boolean;
  userEmail?: string;
  activeView: "home" | "projects" | "new_request" | "project_hub";
  onNavigate: (view: "home" | "projects" | "new_request") => void;
  onOpenAuth: (mode?: "signIn" | "signUp") => void;
  onSignOut: () => void;
}

export function Header({
  isAuthenticated,
  userEmail,
  activeView,
  onNavigate,
  onOpenAuth,
  onSignOut,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand Logo - Clean, no tagline, no badges */}
        <button
          onClick={() => onNavigate(isAuthenticated ? "projects" : "home")}
          className="flex items-center gap-2.5 text-left focus:outline-none"
        >
          <img
            src="/findor-logo.png"
            alt=""
            aria-hidden="true"
            className="h-10 w-9 object-contain"
          />
          <span className="font-bold text-xl text-gray-900 tracking-tight">Findor</span>
        </button>

        {/* Navigation Links */}
        <nav className="flex items-center gap-2 sm:gap-4">
          {isAuthenticated ? (
            <>
              <button
                onClick={() => onNavigate("projects")}
                className={`px-3.5 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeView === "projects" || activeView === "project_hub"
                    ? "bg-gray-100 text-gray-900 font-semibold"
                    : "text-gray-700 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                Projects
              </button>

              <button
                onClick={() => onNavigate("new_request")}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl shadow-sm transition-all active:scale-[0.98]"
              >
                <span>Start a project</span>
              </button>

              <div className="h-5 w-px bg-gray-200 mx-1 hidden sm:block" />

              {/* User Account */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-600 max-w-[120px] truncate hidden md:inline">
                  {userEmail || "Israel"}
                </span>
                <button
                  onClick={onSignOut}
                  title="Sign out"
                  className="px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={() => onNavigate("new_request")}
                className="hidden sm:inline-block px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Services
              </button>
              <button
                onClick={() => onNavigate("home")}
                className="hidden sm:inline-block px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                How it works
              </button>
              <button
                onClick={() => onOpenAuth("signIn")}
                className="px-3.5 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Log in
              </button>
              <button
                onClick={() => onOpenAuth("signUp")}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl shadow-sm transition-all"
              >
                Sign up
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

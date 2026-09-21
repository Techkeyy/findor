import React, { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  normalizeAuthError,
  maskEmail,
  type NormalizedAuthError,
} from "../authErrors";
import { XIcon } from "./UiIcons";

interface AuthModalProps {
  initialMode?: "signIn" | "signUp" | "forgotPassword";
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({
  initialMode = "signIn",
  isOpen,
  onClose,
}: AuthModalProps) {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp" | "forgotPassword">(initialMode);
  const [resetStep, setResetStep] = useState<"email" | "code">("email");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<NormalizedAuthError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [prevInitialMode, setPrevInitialMode] = useState(initialMode);

  // Sync mode when initialMode changes or modal opens (adjust state during render)
  if (isOpen !== prevIsOpen || initialMode !== prevInitialMode) {
    setPrevIsOpen(isOpen);
    setPrevInitialMode(initialMode);
    if (isOpen) {
      setMode(initialMode);
      setResetStep("email");
      setAuthError(null);
      setSuccessMessage(null);
    }
  }

  if (!isOpen) return null;

  const clearErrors = () => {
    setAuthError(null);
    setSuccessMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setAuthError(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim().toLowerCase();

    // Client-side quick validations with friendly messages
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setAuthError({
        code: "INVALID_EMAIL",
        message: "Enter a valid email address.",
        field: "email",
      });
      setIsLoading(false);
      return;
    }

    if (mode === "signUp" && password.length < 8) {
      setAuthError({
        code: "PASSWORD_TOO_SHORT",
        message: "Use a password with at least 8 characters.",
        field: "password",
      });
      setIsLoading(false);
      return;
    }

    if (mode === "forgotPassword" && resetStep === "code" && newPassword.length < 8) {
      setAuthError({
        code: "PASSWORD_TOO_SHORT",
        message: "Use a password with at least 8 characters.",
        field: "newPassword",
      });
      setIsLoading(false);
      return;
    }

    try {
      if (mode === "signIn") {
        await signIn("password", {
          email: cleanEmail,
          password,
          flow: "signIn",
        });
        onClose();
      } else if (mode === "signUp") {
        await signIn("password", {
          email: cleanEmail,
          password,
          flow: "signUp",
        });
        onClose();
      } else if (mode === "forgotPassword") {
        if (resetStep === "email") {
          await signIn("password", {
            email: cleanEmail,
            flow: "reset",
          });
          setSuccessMessage(`We sent a verification code to ${maskEmail(cleanEmail)}.`);
          setResetStep("code");
        } else {
          await signIn("password", {
            email: cleanEmail,
            code: resetCode.trim(),
            newPassword,
            flow: "reset-verification",
          });
          setSuccessMessage("Password updated. You can now sign in.");
          onClose();
        }
      }
    } catch (err: unknown) {
      const normalized = normalizeAuthError(
        err,
        mode === "forgotPassword"
          ? resetStep === "code"
            ? "reset-verification"
            : "reset"
          : mode,
      );
      setAuthError(normalized);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6 relative animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Close"
        >
          <XIcon className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="space-y-1">
          <img
            src="/findor-logo.png"
            alt="Findor"
            className="h-11 w-10 object-contain mb-2"
          />
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
            {mode === "signIn"
              ? "Welcome back"
              : mode === "signUp"
                ? "Create your account"
                : resetStep === "email"
                  ? "Reset your password"
                  : "Enter verification code"}
          </h2>
          <p className="text-xs text-gray-500">
            {mode === "signIn"
              ? "Sign in to track your service requests"
              : mode === "signUp"
                ? "Get your home projects done with vetted local pros"
                : resetStep === "email"
                  ? "Enter your email to receive an 8-digit verification code"
                  : "Check your email for the 8-digit code"}
          </p>
        </div>

        {/* Success Alert */}
        {successMessage && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium">
            {successMessage}
          </div>
        )}

        {/* General Form Error Alert */}
        {authError && authError.field === "general" && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 flex items-center justify-between">
            <span>{authError.message}</span>
            {authError.referenceId && (
              <span className="text-[10px] text-red-400 font-mono tracking-wide ml-2 shrink-0">
                Ref: {authError.referenceId}
              </span>
            )}
          </div>
        )}

        {/* Form */}
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
          {/* Email field */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              disabled={isLoading || (mode === "forgotPassword" && resetStep === "code")}
              onChange={(e) => {
                setEmail(e.target.value);
                if (authError?.field === "email") clearErrors();
              }}
              required
              placeholder="you@example.com"
              className={`w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700 transition-all ${
                authError?.field === "email"
                  ? "border-red-400 bg-red-50/20"
                  : "border-gray-300"
              } disabled:bg-gray-100 disabled:text-gray-500`}
            />
            {authError?.field === "email" && (
              <p className="text-xs text-red-600 mt-1.5 font-medium">
                {authError.message}
              </p>
            )}
          </div>

          {/* Password field for signIn & signUp */}
          {mode !== "forgotPassword" && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-gray-700">
                  Password
                </label>
                {mode === "signIn" && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgotPassword");
                      setResetStep("email");
                      clearErrors();
                    }}
                    className="text-xs text-emerald-800 hover:underline font-medium"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                type="password"
                value={password}
                disabled={isLoading}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (authError?.field === "password") clearErrors();
                }}
                required
                placeholder="At least 8 characters"
                className={`w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700 transition-all ${
                  authError?.field === "password"
                    ? "border-red-400 bg-red-50/20"
                    : "border-gray-300"
                }`}
              />
              {authError?.field === "password" && (
                <p className="text-xs text-red-600 mt-1.5 font-medium">
                  {authError.message}
                </p>
              )}
            </div>
          )}

          {/* Reset Code & New Password fields for forgotPassword step "code" */}
          {mode === "forgotPassword" && resetStep === "code" && (
            <>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  8-Digit Verification Code
                </label>
                <input
                  type="text"
                  value={resetCode}
                  disabled={isLoading}
                  onChange={(e) => {
                    setResetCode(e.target.value);
                    if (authError?.field === "code") clearErrors();
                  }}
                  required
                  placeholder="12345678"
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm font-mono text-gray-900 tracking-widest placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-700 ${
                    authError?.field === "code"
                      ? "border-red-400 bg-red-50/20"
                      : "border-gray-300"
                  }`}
                />
                {authError?.field === "code" && (
                  <p className="text-xs text-red-600 mt-1.5 font-medium">
                    {authError.message}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  disabled={isLoading}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (authError?.field === "newPassword") clearErrors();
                  }}
                  required
                  placeholder="At least 8 characters"
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-700 ${
                    authError?.field === "newPassword"
                      ? "border-red-400 bg-red-50/20"
                      : "border-gray-300"
                  }`}
                />
                {authError?.field === "newPassword" && (
                  <p className="text-xs text-red-600 mt-1.5 font-medium">
                    {authError.message}
                  </p>
                )}
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-emerald-800 hover:bg-emerald-900 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {isLoading && (
              <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {isLoading
              ? mode === "signIn"
                ? "Signing in..."
                : mode === "signUp"
                  ? "Creating account..."
                  : resetStep === "email"
                    ? "Sending code..."
                    : "Updating password..."
              : mode === "signIn"
                ? "Sign In"
                : mode === "signUp"
                  ? "Create Account"
                  : resetStep === "email"
                    ? "Send Verification Code"
                    : "Reset & Sign In"}
          </button>
        </form>

        {/* Mode Switcher / Links */}
        <div className="pt-2 text-center text-xs text-gray-500 border-t border-gray-100 space-y-2">
          {mode === "signIn" && (
            <p>
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signUp");
                  clearErrors();
                }}
                className="font-bold text-emerald-800 hover:underline"
              >
                Sign up
              </button>
            </p>
          )}

          {mode === "signUp" && (
            <p>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signIn");
                  clearErrors();
                }}
                className="font-bold text-emerald-800 hover:underline"
              >
                Sign in
              </button>
            </p>
          )}

          {mode === "forgotPassword" && (
            <p>
              Remember your password?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signIn");
                  clearErrors();
                }}
                className="font-bold text-emerald-800 hover:underline"
              >
                Back to sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true });

/**
 * Wraps the app so any client component can read the current user via
 * useAuth() without prop-drilling. Subscribes to Supabase's own
 * onAuthStateChange so login/logout in one tab is reflected everywhere
 * without a manual refresh.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    // A .catch() here — not `void` — because this isn't only a lint
    // requirement: without handling rejection, a transient network error on
    // the very first auth check would leave `loading` stuck at `true`
    // forever (the .then() callback that calls setLoading(false) simply
    // never runs). `void` would satisfy the linter while leaving that real
    // bug in place; a .catch() fixes both at once — it's what
    // no-floating-promises actually wants to see (a promise chain whose
    // rejection path is handled), not a suppression of the check.
    supabase.auth
      .getUser()
      .then(({ data }) => {
        setUser(data.user);
        setLoading(false);
      })
      .catch((error: unknown) => {
        console.error("Failed to fetch the current user:", error);
        setUser(null);
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

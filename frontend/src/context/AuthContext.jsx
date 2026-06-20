import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const data = await api.getSession();
      setSession(data.authenticated ? data : null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = async (username, password) => {
    const result = await api.login(username, password);
    setSession({
      authenticated: true,
      username: result.username,
      mustChangePassword: result.mustChangePassword,
    });
    return result;
  };

  const logout = async () => {
    await api.logout();
    setSession(null);
  };

  const value = useMemo(() => ({
    session,
    loading,
    isAuthenticated: Boolean(session?.authenticated),
    mustChangePassword: session?.mustChangePassword,
    login,
    logout,
    refreshSession,
  }), [session, loading, refreshSession]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

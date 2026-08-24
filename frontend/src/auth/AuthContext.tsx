import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../api/client';

export type UserRole = 'DOCTOR' | 'SECRETARY' | 'SYSTEM_ADMIN';
export interface SessionProfile { userId: string; role: UserRole }

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';
interface AuthContextValue {
  status: AuthStatus;
  profile: SessionProfile | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<SessionProfile>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [profile, setProfile] = useState<SessionProfile | null>(null);

  const refresh = useCallback(async () => {
    try {
      const nextProfile = await apiRequest<SessionProfile>('/auth/profile');
      setProfile(nextProfile);
      setStatus('authenticated');
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) {
        console.error('Session profile check failed without exposing response data.');
      }
      setProfile(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) void refresh();
    }
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    await apiRequest('/auth/login', { method: 'POST', body: { email, password } });
    const nextProfile = await apiRequest<SessionProfile>('/auth/profile');
    setProfile(nextProfile);
    setStatus('authenticated');
    return nextProfile;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } finally {
      setProfile(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(() => ({ status, profile, refresh, login, logout }), [status, profile, refresh, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

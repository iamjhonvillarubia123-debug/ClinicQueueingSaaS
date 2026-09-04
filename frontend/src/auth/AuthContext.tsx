import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../api/client';

export type UserRole = 'DOCTOR' | 'SECRETARY' | 'SYSTEM_ADMIN';
export interface SessionProfile { userId: string; role: UserRole }

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';
interface AuthContextValue {
  status: AuthStatus;
  profile: SessionProfile | null;
  refresh: () => Promise<void>;
  clearSession: () => void;
  login: (email: string, password: string) => Promise<SessionProfile>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [profile, setProfile] = useState<SessionProfile | null>(null);

  const clearSession = useCallback(() => {
    setProfile(null);
    setStatus('anonymous');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const nextProfile = await apiRequest<SessionProfile>('/auth/profile');
      setProfile(nextProfile);
      setStatus('authenticated');
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) {
        console.error('Session profile check failed without exposing response data.');
      }
      clearSession();
    }
  }, [clearSession]);

  useEffect(() => { void refresh(); }, [refresh]);

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
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(() => ({ status, profile, refresh, clearSession, login, logout }), [status, profile, refresh, clearSession, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

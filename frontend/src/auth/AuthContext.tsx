import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../api/client';

export type UserRole = 'DOCTOR' | 'SECRETARY' | 'SYSTEM_ADMIN';
export interface SessionProfile { userId: string; role: UserRole }
export interface VerificationRequiredLogin {
  verificationRequired: true;
  verificationChannel: 'EMAIL' | 'MOBILE';
  userId: string;
  role: UserRole;
}
export type LoginOutcome = SessionProfile | VerificationRequiredLogin;

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';
interface AuthContextValue {
  status: AuthStatus;
  profile: SessionProfile | null;
  refresh: () => Promise<void>;
  clearSession: () => void;
  login: (identifier: string, password: string) => Promise<LoginOutcome>;
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

  const login = useCallback(async (identifier: string, password: string) => {
    const loginResult = await apiRequest<
      | { user: { id: string; role: UserRole }; lastLoginAt: string }
      | VerificationRequiredLogin
    >('/auth/login', { method: 'POST', body: { identifier, password } });

    if ('verificationRequired' in loginResult && loginResult.verificationRequired) {
      clearSession();
      return loginResult;
    }

    const nextProfile = await apiRequest<SessionProfile>('/auth/profile');
    setProfile(nextProfile);
    setStatus('authenticated');
    return nextProfile;
  }, [clearSession]);

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

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';

const useAuthMock = vi.fn();

vi.mock('./AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

describe('ProtectedRoute', () => {
  it('redirects an authenticated Secretary away from Doctor-only routes', () => {
    useAuthMock.mockReturnValue({
      status: 'authenticated',
      profile: { userId: 'secretary-1', role: 'SECRETARY' },
    });

    render(
      <MemoryRouter initialEntries={['/app/practice-locations']}>
        <Routes>
          <Route element={<ProtectedRoute allowedRoles={['DOCTOR']} />}>
            <Route path="/app/practice-locations" element={<div>Doctor clinics</div>} />
          </Route>
          <Route path="/app" element={<div>Role home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Role home')).toBeInTheDocument();
    expect(screen.queryByText('Doctor clinics')).not.toBeInTheDocument();
  });

  it('allows the matching authenticated role', () => {
    useAuthMock.mockReturnValue({
      status: 'authenticated',
      profile: { userId: 'doctor-1', role: 'DOCTOR' },
    });

    render(
      <MemoryRouter initialEntries={['/app/practice-locations']}>
        <Routes>
          <Route element={<ProtectedRoute allowedRoles={['DOCTOR']} />}>
            <Route path="/app/practice-locations" element={<div>Doctor clinics</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Doctor clinics')).toBeInTheDocument();
  });

  it('redirects anonymous access to sign in', () => {
    useAuthMock.mockReturnValue({ status: 'anonymous', profile: null });

    render(
      <MemoryRouter initialEntries={['/app/practice-locations']}>
        <Routes>
          <Route element={<ProtectedRoute allowedRoles={['DOCTOR']} />}>
            <Route path="/app/practice-locations" element={<div>Doctor clinics</div>} />
          </Route>
          <Route path="/login" element={<div>Sign in page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Sign in page')).toBeInTheDocument();
  });
});

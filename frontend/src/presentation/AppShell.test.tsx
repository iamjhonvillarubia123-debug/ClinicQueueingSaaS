import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useAuth } from '../auth/AuthContext';

vi.mock('../auth/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../auth/AuthContext')>('../auth/AuthContext');
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(useAuth);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderShell(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<h1>Workspace content</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('uses the shared shell with Doctor-authorized navigation', () => {
    mockedUseAuth.mockReturnValue({
      status: 'authenticated',
      profile: { userId: 'doctor-1', role: 'DOCTOR' },
      refresh: vi.fn(), login: vi.fn(), logout: vi.fn(),
    });

    renderShell('/app/practice-locations');

    expect(screen.getByRole('link', { name: 'Clinic Queueing' })).toBeInTheDocument();
    expect(screen.getByText('DOCTOR')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clinics' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Reviews' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Defaults' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Data & Privacy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workspace content' })).toBeInTheDocument();
  });

  it('uses the same shell with the smaller Secretary navigation set', () => {
    mockedUseAuth.mockReturnValue({
      status: 'authenticated',
      profile: { userId: 'secretary-1', role: 'SECRETARY' },
      refresh: vi.fn(), login: vi.fn(), logout: vi.fn(),
    });

    renderShell('/app/secretary/clinics');

    expect(screen.getByText('SECRETARY')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clinics' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reviews' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Defaults' })).not.toBeInTheDocument();
  });

  it('opens and closes the responsive navigation without changing page content', () => {
    mockedUseAuth.mockReturnValue({
      status: 'authenticated',
      profile: { userId: 'secretary-1', role: 'SECRETARY' },
      refresh: vi.fn(), login: vi.fn(), logout: vi.fn(),
    });

    renderShell('/app/secretary/clinics');
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const closeButtons = screen.getAllByRole('button', { name: 'Close navigation' });
    expect(closeButtons).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Workspace content' })).toBeInTheDocument();
    fireEvent.click(closeButtons.find((button) => button.textContent === '×') ?? closeButtons[0]);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

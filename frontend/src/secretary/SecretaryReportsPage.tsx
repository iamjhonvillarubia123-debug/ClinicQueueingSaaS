import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import { ReportsDashboard, type ReportClinic } from '../doctor/DoctorReportsPage';
import type { SecretaryWorkspaceData } from './SecretaryWorkspacePages';

export function SecretaryReportsPage() {
  const [clinics, setClinics] = useState<ReportClinic[]>([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void apiRequest<SecretaryWorkspaceData>('/secretary/workspace')
      .then((workspace) => {
        if (!active) return;
        setClinics(
          workspace.clinics
            .filter(
              (clinic) =>
                clinic.status === 'ACTIVE' &&
                clinic.authorityBundles.includes('REPORTS_VIEW_ONLY'),
            )
            .map((clinic) => ({
              id: clinic.clinicId,
              lifecycleStatus: 'ACTIVE' as const,
              name: clinic.clinicName,
              cityMunicipality: clinic.address,
              province: clinic.doctorName ? `Dr. ${clinic.doctorName}` : null,
            })),
        );
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return <ReportsDashboard clinics={clinics} loadError={loadError} />;
}

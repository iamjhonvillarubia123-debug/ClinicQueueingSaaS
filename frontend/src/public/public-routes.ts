export const publicDoctorPath = (publicIdentifier: string) => `/public/doctors/${encodeURIComponent(publicIdentifier)}`;
export const publicPracticeLocationPath = (publicIdentifier: string) => `/public/practice-locations/${encodeURIComponent(publicIdentifier)}`;
export const publicBookingPath = (publicIdentifier: string) => `/book/${encodeURIComponent(publicIdentifier)}`;

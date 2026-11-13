/**
 * Pure matching rules for the public doctor directory. No Firestore dependency.
 * Matches accented/unaccented French search inputs such as Yaoundé / Yaounde.
 */
export interface SearchableDoctor {
  name: string;
  specialty: string;
  professionalAddress: string | null;
  serviceCity?: string | null;
  serviceDistricts?: string[];
}

export interface DoctorSearchFilters {
  q?: string;
  specialty?: string;
  city?: string;
}

export function normalizeDoctorSearch(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .trim();
}

function includesAny(values: Array<string | null | undefined>, term: string): boolean {
  return values.some((value) => normalizeDoctorSearch(value).includes(term));
}

export function matchesDoctorSearch(doctor: SearchableDoctor, filters: DoctorSearchFilters): boolean {
  const query = normalizeDoctorSearch(filters.q);
  const specialty = normalizeDoctorSearch(filters.specialty);
  const city = normalizeDoctorSearch(filters.city);
  const locations = [
    doctor.serviceCity,
    ...(doctor.serviceDistricts ?? []),
    doctor.professionalAddress,
  ];

  return (
    (!specialty || includesAny([doctor.specialty], specialty)) &&
    (!city || includesAny(locations, city)) &&
    (!query || includesAny([doctor.name, doctor.specialty, ...locations], query))
  );
}

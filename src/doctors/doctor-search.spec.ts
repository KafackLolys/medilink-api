import { matchesDoctorSearch } from './doctor-search';

const doctor = {
  name: 'Dr. Nguema',
  specialty: 'Cardiologie',
  professionalAddress: null,
  serviceCity: 'Yaoundé',
  serviceDistricts: ['Bastos', 'Essos'],
};

describe('matchesDoctorSearch', () => {
  it('lists the doctor with empty filters', () => {
    expect(matchesDoctorSearch(doctor, {})).toBe(true);
  });
  it('matches a city stored in the service zone, not the professional address', () => {
    expect(matchesDoctorSearch(doctor, { city: 'Yaounde' })).toBe(true);
  });
  it('matches a covered district in the location field', () => {
    expect(matchesDoctorSearch(doctor, { city: 'bastos' })).toBe(true);
  });
  it('searches doctor name, specialty and location', () => {
    expect(matchesDoctorSearch(doctor, { q: 'cardio', city: 'Essos' })).toBe(true);
    expect(matchesDoctorSearch(doctor, { q: 'nguema' })).toBe(true);
  });
  it('excludes unrelated locations and specialties', () => {
    expect(matchesDoctorSearch(doctor, { city: 'Douala' })).toBe(false);
    expect(matchesDoctorSearch(doctor, { specialty: 'Neurologie' })).toBe(false);
  });
  it('supports doctors without a configured service area', () => {
    const legacy = { ...doctor, serviceCity: null, serviceDistricts: [], professionalAddress: 'Douala, Akwa' };
    expect(matchesDoctorSearch(legacy, { city: 'Akwa' })).toBe(true);
  });
});

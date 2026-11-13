#!/usr/bin/env node
/**
 * Read-only by default. Run from medilink-api, with your existing Firebase
 * service-account env vars or ADC. Never paste private keys into the command.
 *
 * node scripts/doctor-directory-diagnostic.cjs --uid FIREBASE_UID
 * node scripts/doctor-directory-diagnostic.cjs --uid FIREBASE_UID --repair
 */
'use strict';
try { require('dotenv').config(); } catch { /* Env may already be injected. */ }
const { initializeApp, getApps, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

async function run() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--uid');
  const uid = i >= 0 ? args[i + 1] : null;
  const repair = args.includes('--repair');
  const acknowledged = args.includes('--confirm-production');
  if (!uid || typeof uid !== 'string' || !/^[A-Za-z0-9_-]{10,128}$/.test(uid) || uid.startsWith('--') || args.some((arg) => arg.startsWith('--') && !['--uid', '--repair', '--confirm-production'].includes(arg))) {
    console.error('Usage: node scripts/doctor-directory-diagnostic.cjs --uid FIREBASE_UID [--repair --confirm-production]');
    process.exitCode = 2;
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const cred = projectId && clientEmail && privateKey
    ? cert({ projectId, clientEmail, privateKey })
    : applicationDefault();
  const app = getApps()[0] ?? initializeApp({ credential: cred, ...(projectId ? { projectId } : {}) });
  const db = getFirestore(app);

  const userRef = db.collection('users').doc(uid);
  const [userSnap, profileSnap, zoneSnap] = await Promise.all([
    userRef.get(),
    db.collection('doctorProfiles').where('userId', '==', uid).limit(2).get(),
    db.collection('doctorServiceAreaSettings').doc(uid).get(),
  ]);
  const user = userSnap.exists ? userSnap.data() : null;
  const profiles = profileSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const profile = profiles.length === 1 ? profiles[0].data : null;
  const zone = zoneSnap.exists ? zoneSnap.data() : null;
  const issues = [];
  if (!user) issues.push('Document users introuvable.');
  else if (user.role !== 'doctor') issues.push('users.role ne vaut pas doctor.');
  if (profiles.length === 0) issues.push('Aucun doctorProfiles avec userId = UID.');
  if (profiles.length > 1) issues.push('Plusieurs doctorProfiles avec le même userId.');
  if (profile && profile.verificationStatus !== 'verified') issues.push('doctorProfiles.verificationStatus ne vaut pas verified.');
  if (user && user.status !== 'active') issues.push(user.status === 'verified' ? "users.status='verified' est invalide : seule la validation du PROFIL doit être 'verified'." : 'users.status ne vaut pas active.');
  if (!zoneSnap.exists) issues.push('Aucune zone doctorServiceAreaSettings ; filtre ville limité à professionalAddress.');
  if (!zone?.city && !profile?.professionalAddress) issues.push('Aucune ville/zone professionnelle renseignée.');

  console.log(JSON.stringify({
    projectId: app.options.projectId ?? projectId ?? '(ADC)',
    account: { exists: Boolean(user), role: user?.role ?? null, status: user?.status ?? null },
    professionalProfile: {
      count: profiles.length,
      id: profiles.length === 1 ? profiles[0].id : null,
      verificationStatus: profile?.verificationStatus ?? null,
      hasProfessionalAddress: Boolean(profile?.professionalAddress),
    },
    serviceArea: { exists: zoneSnap.exists, city: zone?.city ?? null, districtsCount: Array.isArray(zone?.districts) ? zone.districts.length : 0 },
    eligibleWithoutFilters: Boolean(user?.role === 'doctor' && user?.status === 'active' && profile?.verificationStatus === 'verified' && profiles.length === 1),
    repairable: Boolean(user?.role === 'doctor' && ['pending', 'verified'].includes(user.status) && profile?.verificationStatus === 'verified' && profiles.length === 1),
    issues,
  }, null, 2));

  if (!repair) return;
  if (!acknowledged) throw new Error('Repair requires --repair --confirm-production after reviewing the dry-run.');
  if (!(user?.role === 'doctor' && ['pending', 'verified'].includes(user.status) && profile?.verificationStatus === 'verified' && profiles.length === 1)) {
    throw new Error('Repair refused: doctor must have pending/legacy verified account and a verified professional profile.');
  }
  await db.runTransaction(async (tx) => {
    const [currentUser, currentProfile] = await Promise.all([
      tx.get(userRef),
      tx.get(profileSnap.docs[0].ref),
    ]);
    if (!currentUser.exists || !['pending', 'verified'].includes(currentUser.data()?.status) || currentUser.data()?.role !== 'doctor'
      || !currentProfile.exists || currentProfile.data()?.verificationStatus !== 'verified') {
      throw new Error('Account changed since inspection; repair aborted.');
    }
    tx.update(userRef, { status: 'active', updatedAt: new Date() });
  });
  console.log('Repair completed: invalid/pending users.status -> active. Professional verification remains verified.');
}
run().catch((err) => { console.error(err?.message ?? err); process.exitCode = 1; });

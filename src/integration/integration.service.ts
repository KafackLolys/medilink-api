import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { DocumentReference } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { BloodType } from '../interfaces/database';

// Code pays utilisé quand une ville est créée dans le catalogue `cities`.
const DEFAULT_COUNTRY_CODE = 'CM';

export type DoctorZoneInput = {
  city: string;
  districts: string[];
  radiusKm: number;
  maxDistanceKm: number;
};
export type PatientProfileInput = {
  name: string;
  phone: string;
  bloodType: string;
  city: string;
  district: string;
};
export type ContactInput = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

const VALID_BLOOD_TYPES = new Set<string>(Object.values(BloodType));

@Injectable()
export class IntegrationService {
  constructor(private readonly firebase: FirebaseService) { }

  private async assertRole(uid: string, role: 'doctor' | 'patient') {
    const user = await this.firebase
      .getFirestore()
      .collection('users')
      .doc(uid)
      .get();
    if (
      !user.exists ||
      user.data()?.role !== role ||
      ['suspended', 'deleted'].includes(String(user.data()?.status))
    ) {
      throw new ForbiddenException(
        'Vous ne pouvez pas accéder à cette fonctionnalité.',
      );
    }
  }

  async getDoctorZone(uid: string): Promise<DoctorZoneInput> {
    await this.assertRole(uid, 'doctor');
    const snapshot = await this.firebase
      .getFirestore()
      .collection('doctorServiceAreaSettings')
      .doc(uid)
      .get();
    const zone = snapshot.data();
    return {
      city: String(zone?.city ?? ''),
      districts: Array.isArray(zone?.districts) ? zone.districts : [],
      radiusKm: Number(zone?.radiusKm ?? 10),
      maxDistanceKm: Number(zone?.maxDistanceKm ?? 25),
    };
  }

  async saveDoctorZone(
    uid: string,
    body: DoctorZoneInput,
  ): Promise<DoctorZoneInput> {
    await this.assertRole(uid, 'doctor');
    if (
      !body ||
      typeof body.city !== 'string' ||
      !body.city.trim() ||
      body.city.length > 100 ||
      !Array.isArray(body.districts) ||
      body.districts.length > 40 ||
      body.districts.some(
        (d) => typeof d !== 'string' || !d.trim() || d.length > 100,
      ) ||
      !Number.isInteger(body.radiusKm) ||
      body.radiusKm < 1 ||
      body.radiusKm > 250 ||
      !Number.isInteger(body.maxDistanceKm) ||
      body.maxDistanceKm < 1 ||
      body.maxDistanceKm > 500 ||
      body.maxDistanceKm < body.radiusKm
    ) {
      throw new BadRequestException('Paramètres de zone invalides.');
    }
    const zone = {
      city: body.city.trim(),
      districts: [...new Set(body.districts.map((d) => d.trim()))],
      radiusKm: body.radiusKm,
      maxDistanceKm: body.maxDistanceKm,
    };
    await this.firebase
      .getFirestore()
      .collection('doctorServiceAreaSettings')
      .doc(uid)
      .set(
        { ...zone, ownerUserId: uid, updatedAt: new Date() },
        { merge: true },
      );
    return zone;
  }

  /**
   * Retrouve (ou prépare la création de) la ville et le quartier dans les
   * catalogues `cities` / `districts`. Les créations sont renvoyées pour être
   * ajoutées au batch de l'appelant.
   */
  private async resolveLocation(city: string, district: string) {
    const db = this.firebase.getFirestore();
    const now = new Date();
    const creates: {
      ref: DocumentReference;
      data: Record<string, unknown>;
    }[] = [];

    const citySnap = await db
      .collection('cities')
      .where('name', '==', city)
      .limit(1)
      .get();
    let cityId = citySnap.docs[0]?.id;
    if (!cityId) {
      const ref = db.collection('cities').doc();
      cityId = ref.id;
      creates.push({
        ref,
        data: {
          id: ref.id,
          name: city,
          countryCode: DEFAULT_COUNTRY_CODE,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    const districtSnap = citySnap.docs[0]
      ? await db
        .collection('districts')
        .where('cityId', '==', cityId)
        .where('name', '==', district)
        .limit(1)
        .get()
      : null;
    let districtId = districtSnap?.docs[0]?.id;
    if (!districtId) {
      const ref = db.collection('districts').doc();
      districtId = ref.id;
      creates.push({
        ref,
        data: {
          id: ref.id,
          cityId,
          name: district,
          centerLatitude: null,
          centerLongitude: null,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    return { cityId, districtId, creates };
  }

  async savePatientProfile(
    uid: string,
    body: PatientProfileInput,
  ): Promise<{ saved: boolean }> {
    await this.assertRole(uid, 'patient');
    if (
      !body ||
      typeof body.name !== 'string' ||
      body.name.trim().length < 2 ||
      body.name.length > 150 ||
      typeof body.phone !== 'string' ||
      body.phone.trim().length < 6 ||
      body.phone.length > 30 ||
      typeof body.city !== 'string' ||
      body.city.length > 100 ||
      typeof body.district !== 'string' ||
      body.district.length > 100 ||
      !VALID_BLOOD_TYPES.has(body.bloodType)
    ) {
      throw new BadRequestException('Informations patient invalides.');
    }
    const city = body.city.trim();
    const district = body.district.trim();
    if (Boolean(city) !== Boolean(district)) {
      throw new BadRequestException(
        'Veuillez renseigner la ville et le quartier.',
      );
    }

    const parts = body.name.trim().split(/\s+/);
    const firstName = parts.shift() ?? '';
    const lastName = parts.join(' ');
    const fullName = body.name.trim();
    const db = this.firebase.getFirestore();
    const now = new Date();

    const profileSnapshot = await db
      .collection('patientProfiles')
      .where('userId', '==', uid)
      .limit(1)
      .get();
    const profileDoc = profileSnapshot.docs[0];
    const profileUpdate: Record<string, unknown> = {
      bloodType: body.bloodType,
      fullName,
      updatedAt: now,
    };

    const batch = db.batch();
    batch.update(db.collection('users').doc(uid), {
      firstName,
      lastName,
      phone: body.phone.trim(),
      updatedAt: now,
    });
    batch.set(
      db.collection('patients').doc(uid),
      { bloodType: body.bloodType, fullName, updatedAt: now },
      { merge: true },
    );

    if (city && district) {
      const { cityId, districtId, creates } = await this.resolveLocation(
        city,
        district,
      );
      for (const { ref, data } of creates) batch.set(ref, data);

      // Adresse principale : celle du profil, sinon celle marquée isPrimary.
      let addressRef: DocumentReference | null = null;
      const primaryId = profileDoc?.data().primaryAddressId;
      if (typeof primaryId === 'string' && primaryId) {
        const ref = db.collection('addresses').doc(primaryId);
        const snap = await ref.get();
        if (snap.exists && snap.data()?.userId === uid) addressRef = ref;
      }
      if (!addressRef) {
        const found = await db
          .collection('addresses')
          .where('userId', '==', uid)
          .where('isPrimary', '==', true)
          .limit(1)
          .get();
        addressRef = found.docs[0]?.ref ?? null;
      }

      if (addressRef) {
        batch.update(addressRef, { cityId, districtId, updatedAt: now });
      } else {
        const ref = db.collection('addresses').doc();
        batch.set(ref, {
          id: ref.id,
          userId: uid,
          cityId,
          districtId,
          label: null,
          addressLine: null,
          latitude: null,
          longitude: null,
          isPrimary: true,
          createdAt: now,
          updatedAt: now,
        });
        profileUpdate.primaryAddressId = ref.id;
      }
    }

    if (profileDoc) batch.update(profileDoc.ref, profileUpdate);
    await batch.commit();
    return { saved: true };
  }

  async createContact(body: ContactInput): Promise<{ id: string }> {
    if (
      !body ||
      typeof body.name !== 'string' ||
      body.name.trim().length < 2 ||
      body.name.length > 120 ||
      typeof body.email !== 'string' ||
      body.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
      typeof body.subject !== 'string' ||
      body.subject.trim().length < 3 ||
      body.subject.length > 150 ||
      typeof body.message !== 'string' ||
      body.message.trim().length < 10 ||
      body.message.length > 5000
    ) {
      throw new BadRequestException(
        'Veuillez vérifier les informations du formulaire.',
      );
    }
    const ref = this.firebase
      .getFirestore()
      .collection('contactMessages')
      .doc();
    await ref.create({
      id: ref.id,
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      subject: body.subject.trim(),
      message: body.message.trim(),
      status: 'new',
      createdAt: new Date(),
    });
    return { id: ref.id };
  }

  // V2 : mêmes comportements, une seule implémentation à maintenir.
  getDoctorZoneV2(uid: string): Promise<DoctorZoneInput> {
    return this.getDoctorZone(uid);
  }

  saveDoctorZoneV2(
    uid: string,
    body: DoctorZoneInput,
  ): Promise<DoctorZoneInput> {
    return this.saveDoctorZone(uid, body);
  }

  savePatientProfileV2(
    uid: string,
    body: PatientProfileInput,
  ): Promise<{ saved: boolean }> {
    return this.savePatientProfile(uid, body);
  }

  createContactV2(body: ContactInput): Promise<{ id: string }> {
    return this.createContact(body);
  }
}
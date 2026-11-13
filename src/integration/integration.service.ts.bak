import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

export type DoctorZoneInput = {
  city: string; districts: string[]; radiusKm: number; maxDistanceKm: number;
};
export type PatientProfileInput = {
  name: string; phone: string; bloodType: string; city: string; district: string;
};
export type ContactInput = { name: string; email: string; subject: string; message: string };

const VALID_BLOOD_TYPES = new Set([
  'a_positive','a_negative','b_positive','b_negative','ab_positive','ab_negative','o_positive','o_negative','unknown',
]);

@Injectable()
export class IntegrationService {
  constructor(private readonly firebase: FirebaseService) {}

  private async assertRole(uid: string, role: 'doctor' | 'patient') {
    const user = await this.firebase.getFirestore().collection('users').doc(uid).get();
    if (!user.exists || user.data()?.role !== role || ['suspended','deleted'].includes(String(user.data()?.status))) {
      throw new ForbiddenException('Vous ne pouvez pas accéder à cette fonctionnalité.');
    }
  }

  async getDoctorZone(uid: string): Promise<DoctorZoneInput> {
    await this.assertRole(uid,'doctor');
    const snapshot = await this.firebase.getFirestore().collection('doctorServiceAreaSettings').doc(uid).get();
    const zone = snapshot.data();
    return { city: String(zone?.city ?? ''), districts: Array.isArray(zone?.districts) ? zone.districts : [],
      radiusKm: Number(zone?.radiusKm ?? 10), maxDistanceKm: Number(zone?.maxDistanceKm ?? 25) };
  }

  async saveDoctorZone(uid: string, body: DoctorZoneInput): Promise<DoctorZoneInput> {
    await this.assertRole(uid,'doctor');
    if (!body || typeof body.city !== 'string' || !body.city.trim() || body.city.length > 100 ||
        !Array.isArray(body.districts) || body.districts.length > 40 ||
        body.districts.some(d=>typeof d!=='string'|| !d.trim() || d.length>100) ||
        !Number.isInteger(body.radiusKm) || body.radiusKm<1 || body.radiusKm>250 ||
        !Number.isInteger(body.maxDistanceKm) || body.maxDistanceKm<1 || body.maxDistanceKm>500 ||
        body.maxDistanceKm < body.radiusKm) {
      throw new BadRequestException('Paramètres de zone invalides.');
    }
    const zone = {city:body.city.trim(),districts:[...new Set(body.districts.map(d=>d.trim()))],
      radiusKm:body.radiusKm,maxDistanceKm:body.maxDistanceKm};
    await this.firebase.getFirestore().collection('doctorServiceAreaSettings').doc(uid)
      .set({...zone,ownerUserId:uid,updatedAt:new Date()},{merge:true});
    return zone;
  }

  async savePatientProfile(uid: string, body: PatientProfileInput): Promise<{saved:boolean}> {
    await this.assertRole(uid,'patient');
    if (!body || typeof body.name!=='string' || body.name.trim().length<2 || body.name.length>150 ||
        typeof body.phone!=='string' || body.phone.trim().length<6 || body.phone.length>30 ||
        typeof body.city!=='string' || body.city.length>100 || typeof body.district!=='string' || body.district.length>100 ||
        !VALID_BLOOD_TYPES.has(body.bloodType)) {
      throw new BadRequestException('Informations patient invalides.');
    }
    const parts=body.name.trim().split(/\s+/);
    const firstName=parts.shift() ?? '';
    const lastName=parts.join(' ');
    const db=this.firebase.getFirestore();
    const patientSnap=await db.collection('patients').doc(uid).get();
    const patientId=String(patientSnap.data()?.id ?? uid);
    const patientProfileSnapshot=await db.collection('patientProfiles').where('userId','==',uid).limit(1).get();
    const profileRef=patientProfileSnapshot.docs[0]?.ref;
    const now=new Date();
    const batch=db.batch();
    batch.update(db.collection('users').doc(uid),{firstName,lastName,phone:body.phone.trim(),updatedAt:now});
    batch.set(db.collection('patients').doc(uid),{bloodType:body.bloodType,fullName:body.name.trim(),updatedAt:now},{merge:true});
    if (profileRef) batch.update(profileRef,{bloodType:body.bloodType,fullName:body.name.trim(),updatedAt:now});
    // Keep the existing address association if present; do not expose sensitive street fields.
    const addresses=await db.collection('addresses').where('patientProfileId','==',patientId).limit(1).get();
    if(addresses.docs[0]) batch.update(addresses.docs[0].ref,{city:body.city.trim(),district:body.district.trim(),updatedAt:now});
    // Otherwise, do not create an incomplete Address with missing required schema fields.
    if(!addresses.docs[0] && (body.city.trim() || body.district.trim())) {
      throw new BadRequestException('Adresse introuvable. Créez d’abord une adresse patient valide.');
    }
    await batch.commit();
    return {saved:true};
  }

  async createContact(body: ContactInput): Promise<{id:string}> {
    if(!body || typeof body.name!=='string'||body.name.trim().length<2||body.name.length>120 ||
       typeof body.email!=='string'||body.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
       typeof body.subject!=='string'||body.subject.trim().length<3||body.subject.length>150 ||
       typeof body.message!=='string'||body.message.trim().length<10||body.message.length>5000) {
      throw new BadRequestException('Veuillez vérifier les informations du formulaire.');
    }
    const ref=this.firebase.getFirestore().collection('contactMessages').doc();
    await ref.create({id:ref.id,name:body.name.trim(),email:body.email.trim().toLowerCase(),
      subject:body.subject.trim(),message:body.message.trim(),status:'new',createdAt:new Date()});
    return {id:ref.id};
  }
}

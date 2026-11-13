import { Controller, Get } from '@nestjs/common';
import { DoctorsService } from './doctors.service';

/** Public directory data only. Never return doctor accounts or private documents. */
@Controller('public/doctors')
export class PublicDoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Get('recommended')
  async recommended() {
    // The directory already filters for a verified professional profile
    // AND an active doctor account. No authentication is required here.
    const { doctors } = await this.doctorsService.list({});
    const ranked = doctors.sort((left, right) => {
      // Review count breaks the tie in mean rating, avoiding fake endorsements.
      const leftRating = left.rating ?? -1;
      const rightRating = right.rating ?? -1;
      if (rightRating !== leftRating) return rightRating - leftRating;
      if (right.reviewsCount !== left.reviewsCount) {
        return right.reviewsCount - left.reviewsCount;
      }
      return left.name.localeCompare(right.name, 'fr');
    });
    return { doctors: ranked.slice(0, 3) };
  }
}

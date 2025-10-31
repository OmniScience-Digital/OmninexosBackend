import { DateTime } from 'luxon';
// Clean timestamp using Luxon
export function getJhbTimestamp() {
  return DateTime.now().setZone('Africa/Johannesburg').toFormat('yyyy-MM-dd HH:mm:ss'); // 2025-10-06 15:20:30
}

//  helper functions
export function getJhbDate(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }));
}

export function parseDateInJhb(dateString: string | undefined): Date | null {
  return dateString
    ? new Date(new Date(dateString).toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }))
    : null;
}

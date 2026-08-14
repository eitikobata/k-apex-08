import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
/** Granular scope check, e.g. @RequirePermissions('kuro_ice:approve_shatter') */
export const RequirePermissions = (...scopes: string[]) => SetMetadata(PERMISSIONS_KEY, scopes);

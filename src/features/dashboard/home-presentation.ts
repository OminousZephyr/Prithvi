import type { AuthSnapshot } from '@/features/account/account-types';
import { translate } from '../../localization/resources.ts';
import type { Language } from '@/services/localization/contracts';

export function homeHeaderPresentation(account: Pick<AuthSnapshot, 'status' | 'displayName'> | undefined, language: Language) {
  const name = account?.status === 'signed_in' && account.displayName?.trim() ? account.displayName.trim() : translate(language, 'homeFarmer');
  return {
    greeting: translate(language, 'homeGreeting').replace('{name}', name),
    profileInitial: Array.from(name)[0]?.toLocaleUpperCase(language === 'hi' ? 'hi-IN' : 'en-IN') ?? '•',
    profileName: account?.status === 'signed_in' ? name : undefined,
    accessibleAccountLabel: translate(language, 'homeAccountOpen'),
  };
}

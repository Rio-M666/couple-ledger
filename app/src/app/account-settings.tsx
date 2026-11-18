import { router } from 'expo-router';

import { SettingsScreen } from '@/components/settings-screen';

export default function AccountSettings() {
  return <SettingsScreen onClose={() => router.dismissTo('/onboarding')} />;
}

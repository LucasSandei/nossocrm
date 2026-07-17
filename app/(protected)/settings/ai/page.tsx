import type { Metadata } from 'next';
import SettingsPage from '@/features/settings/SettingsPage'

export const metadata: Metadata = { title: 'IA – Configurações | LS CRM' };

export default function SettingsAI() {
  return <SettingsPage tab="ai" />
}

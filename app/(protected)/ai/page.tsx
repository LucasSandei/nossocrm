import type { Metadata } from 'next';
import { AIHubPage } from '@/features/ai-hub/AIHubPage'

export const metadata: Metadata = { title: 'AI Hub | LS CRM' };

export default function AIHub() {
    return <AIHubPage />
}

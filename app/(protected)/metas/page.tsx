import type { Metadata } from 'next';
import GoalsPage from '@/features/goals/GoalsPage';

export const metadata: Metadata = { title: 'Gestão de Metas | LS CRM' };

export default function Metas() {
  return <GoalsPage />;
}

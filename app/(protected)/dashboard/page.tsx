import type { Metadata } from 'next';
import DashboardPage from '@/features/dashboard/DashboardPage'

export const metadata: Metadata = { title: 'Dashboard | LS CRM' };

export default function Dashboard() {
    return <DashboardPage />
}

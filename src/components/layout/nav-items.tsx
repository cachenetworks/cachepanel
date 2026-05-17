import {
  Activity,
  Box,
  Calendar,
  Cloud,
  Database,
  Film,
  Folder,
  KeyRound,
  Layers,
  Package,
  ScrollText,
  Server,
  Settings,
  Sparkles,
  TerminalSquare,
  Users,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  ownerOnly?: boolean;
}

// Single source of truth for the panel's nav. Shared between desktop sidebar
// and mobile drawer so neither falls out of sync (which they had — mobile
// was missing /apps, /admin/recordings, /admin/batch, /schedules,
// /account/security before this extraction).
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <Activity className="h-4 w-4" /> },
  { href: '/terminal', label: 'Terminal', icon: <TerminalSquare className="h-4 w-4" /> },
  { href: '/files', label: 'Files', icon: <Folder className="h-4 w-4" /> },
  { href: '/docker', label: 'Docker', icon: <Box className="h-4 w-4" /> },
  { href: '/apps', label: 'Apps', icon: <Package className="h-4 w-4" /> },
  { href: '/databases', label: 'Databases', icon: <Database className="h-4 w-4" /> },
  { href: '/tunnels', label: 'Tunnels', icon: <Cloud className="h-4 w-4" /> },
  { href: '/assistant', label: 'Assistant', icon: <Sparkles className="h-4 w-4" /> },
  { href: '/admin/servers', label: 'Servers', icon: <Server className="h-4 w-4" /> },
  { href: '/admin/users', label: 'Users', icon: <Users className="h-4 w-4" /> },
  { href: '/admin/audit', label: 'Audit log', icon: <ScrollText className="h-4 w-4" /> },
  { href: '/admin/recordings', label: 'Recordings', icon: <Film className="h-4 w-4" />, ownerOnly: true },
  { href: '/admin/batch', label: 'Batch actions', icon: <Layers className="h-4 w-4" /> },
  { href: '/schedules', label: 'Schedules', icon: <Calendar className="h-4 w-4" /> },
  { href: '/account/security', label: 'Security (2FA)', icon: <KeyRound className="h-4 w-4" /> },
  { href: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

export function visibleNavItems(role: 'OWNER' | 'ADMIN'): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.ownerOnly || role === 'OWNER');
}

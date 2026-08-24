export type DesktopUpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'disabled';

export type DesktopUpdaterState = {
  status: DesktopUpdaterStatus;
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  lastCheckedAt: string | null;
  error: string | null;
  snoozeUntil: string | null;
  enabled: boolean;
  edition: string;
};

export type DesktopUpdaterSnoozeOption = {
  id: string;
  label: string;
};

export type DesktopUpdaterPromptPayload = {
  reason?: 'available' | 'reminder' | 'downloaded';
  version?: string;
};

export enum AlertSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum AlertType {
  FIRE = 'FIRE',
  DISASTER = 'DISASTER',
  CRIME = 'CRIME',
  INFESTATION = 'INFESTATION',
  LOCKDOWN = 'LOCKDOWN'
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'USER';
  groupId?: string;
}

export interface Group {
  id: string; // The "Special ID"
  name: string;
  adminId: string;
  members: User[];
}

export interface Camera {
  id: string;
  name: string;
  streamUrl: string; // Server URL
  streamKey: string; // OBS-style Secret Key
  status: 'ONLINE' | 'OFFLINE';
}

export interface EmergencyAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  location: string;
  timestamp: Date;
  resolvedAt?: Date;
  status: 'ACTIVE' | 'RESOLVED' | 'VERIFYING';
  description: string;
  triggeredBy: string; // User ID
}

export interface Complaint {
  id: string;
  subject: string;
  description: string;
  createdAt: Date;
  createdBy: string;
  reporterName: string;
  groupId: string;
  status: 'OPEN' | 'CLOSED';
}

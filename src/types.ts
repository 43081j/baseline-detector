export interface DetectOptions {
  cwd?: string;
}

export interface DetectSourceOptions {
  fileName?: string;
}

// high = widely available, low = newly available, false = limited availability
export type BaselineStatus = 'high' | 'low' | false;

export interface BaselineTarget {
  status: BaselineStatus;
  // The feature that determined the status
  reason: string | null;
}
